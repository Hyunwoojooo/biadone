import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
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

async function readFileEventually(filePath, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await readFile(filePath, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await delay(20);
  }
  assert.fail(`timed out waiting for ${filePath}`);
}

function spawnBuiltBinary(
  build,
  arguments_,
  { cwd, environment = {}, input = "", timeoutMs = 15_000 } = {},
) {
  const child = spawn(build.binaryPath, arguments_, {
    cwd,
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
  "Blabee verified the selected action locally. Execute exactly this action JSON as the new user request. The visible task preview and ref are not execution authority, and a queue receipt is not proof that the work succeeded.\n";

// Legacy ref-only input remains valid after an app update. New production
// dispatches include a readable preview and are covered by Swift dispatch tests.
function legacyQueuedPrompt(continuationID, enabledProjectPath) {
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

function assertLegacyQueuedPrompt(
  message,
  { action, continuationID, enabledProjectPath, identifiers },
) {
  assert.equal(message, legacyQueuedPrompt(continuationID, enabledProjectPath));
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
    next_actions: [
      {
        title: `Continue ${suffix}`,
        objective: `Perform the verified ${suffix} continuation`,
        constraints: ["Keep the binding exact"],
        done_when: [`The ${suffix} continuation completes`],
      },
      {
        title: `Review ${suffix}`,
        objective: `Review the verified ${suffix} continuation`,
        constraints: ["Keep the review bounded"],
        done_when: [`The ${suffix} review completes`],
      },
    ],
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

test("shared-root subagent Hooks preserve parent decisions and isolate concurrent approval delivery", async () => {
  const server = await startOperationalServer();
  const hookChildren = [];
  const rootID = "01a0949b-0000-7000-8000-000000000001";
  const threads = [rootID,
    "01a0949b-0000-7000-8000-000000000002",
    "01a0949b-0000-7000-8000-000000000003",
  ];
  const turns = threads.map((_, index) => `01a0949c-0000-7000-8000-00000000000${index + 1}`);
  const rawHook = (event, index, fields = {}) => hookPayload(event, {
    session_id: rootID,
    ...(index === 0 ? {} : { agent_id: threads[index], agent_type: "worker" }),
    cwd: server.enabledProjectPath,
    turn_id: turns[index],
    ...fields,
  });
  const callHook = (event, payload) => runBuiltBinary(server.build,
    ["hook", event, "--socket", server.socketPath],
    { input: JSON.stringify(payload) });
  const idsFrom = (output) => {
    assert.equal(output.code, 0);
    assert.equal(output.stderr, "");
    const context = JSON.parse(output.stdout).hookSpecificOutput.additionalContext;
    return Object.fromEntries([
      "project_id", "session_id", "source_turn_id", "source_prompt_id", "episode_id",
      "episode_root_prompt_id", "episode_baseline_checkpoint_id", "correlation_token",
    ].map((key) => [key, contextValue(context, key)]));
  };
  const snapshotUntil = async (predicate) => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const response = await udsRequest(server.socketPath, "pet_snapshot", {
        schema_version: "1.0", kind: "blabee_pet_snapshot_request", consumer_heartbeat: true,
      });
      assert.equal(response.ok, true);
      if (predicate(response.result)) return response.result;
      await delay(20);
    }
    assert.fail("concurrent Hook state did not become available");
  };
  try {
    const identities = [];
    for (let index = 0; index < threads.length; index += 1) {
      const ids = idsFrom(await callHook("UserPromptSubmit", rawHook("UserPromptSubmit", index, {
        prompt: `Synthetic concurrent task ${index}`,
      })));
      assert.equal(ids.session_id, threads[index], "the effective thread must not be the shared root");
      identities.push(ids);
    }
    // Both child prompts already ran: the parent's original authority must remain valid.
    const offered = proposal(identities[0], "parent_after_children");
    const emitted = await udsRequest(server.socketPath, "emit_decision",
      proposalWrapper(identities[0], offered));
    assert.equal(emitted.ok, true, JSON.stringify(emitted.error));
    await callHook("Stop", rawHook("Stop", 0, {
      stop_hook_active: false, last_assistant_message: "Synthetic root result",
    }));
    const waiting = await waitForInteraction(server.socketPath, 1);
    assert.equal(waiting.interaction.session_id, rootID);

    // Start real Hook adapter processes; only their synthetic requests are resolved.
    await snapshotUntil(() => true);
    for (let index = 0; index < threads.length; index += 1) {
      const child = spawnBuiltBinary(server.build,
        ["hook", "PermissionRequest", "--socket", server.socketPath], {
          input: JSON.stringify(rawHook("PermissionRequest", index, {
            tool_name: "Bash", tool_input: { command: `fictional-concurrent-command-${index}` },
          })),
        });
      // Attach a rejection handler immediately, retaining the actual result for assertions.
      child.completion.catch(() => {});
      hookChildren.push(child);
      await snapshotUntil((state) => state.permission_requests.length === index + 1);
    }
    const pending = await snapshotUntil((state) => state.permission_requests.length === 3);
    assert.deepEqual(pending.permission_requests.map((request) => request.session_id), threads);
    assert.equal(pending.interactions[0].session_id, rootID);
    for (let index = 0; index < threads.length; index += 1) {
      const head = pending.permission_requests[index];
      const decision = index === 1 ? "deny" : "defer_to_codex";
      const resolution = {
        schema_version: "1.0", kind: "blabee_permission_resolution_request",
        request_id: head.request_id, response_id: `response_concurrent_${index}`,
        project_id: head.project_id, session_id: head.session_id, turn_id: head.turn_id, decision,
      };
      const wrongThread = await udsRequest(server.socketPath, "resolve_permission_request", {
        ...resolution, session_id: threads[(index + 1) % threads.length],
      });
      assert.equal(wrongThread.ok, false);
      assert.equal(wrongThread.error.code, "permission_request_binding_mismatch");
      const resolved = await udsRequest(server.socketPath, "resolve_permission_request", resolution);
      assert.equal(resolved.ok, true, JSON.stringify(resolved.error));
      const completion = await hookChildren[index].completion;
      assert.equal(completion.code, 0);
      assert.equal(completion.stderr, "");
      if (decision === "deny") {
        assert.equal(JSON.parse(completion.stdout).hookSpecificOutput.decision.behavior, "deny");
      } else {
        assert.equal(completion.stdout, "");
      }
      await snapshotUntil((state) => state.permission_requests.length === threads.length - index - 1);
    }

    // A queued reference delivered to a sibling cannot consume the parent's action.
    const focused = await udsRequest(server.socketPath, "focus_interaction", focusRequest(waiting.interaction));
    assert.equal(focused.ok, true);
    const selected = await udsRequest(server.socketPath, "select", selection(waiting.interaction, "root_isolated"));
    assert.equal(selected.ok, true, JSON.stringify(selected.error));
    const message = legacyQueuedPrompt(selected.result.outcome.continuation_id, server.enabledProjectPath);
    const misplaced = await callHook("UserPromptSubmit", rawHook("UserPromptSubmit", 1, {
      turn_id: "turn_wrong_child_delivery", prompt: message,
    }));
    assert.equal(misplaced.code, 0);
    assert.equal(misplaced.stdout.includes(QUEUED_ACTION_CONTEXT_MARKER), false);
    const delivered = await callHook("UserPromptSubmit", rawHook("UserPromptSubmit", 0, {
      turn_id: "turn_right_parent_delivery", prompt: message,
    }));
    const deliveredContext = JSON.parse(delivered.stdout).hookSpecificOutput.additionalContext;
    assert.equal(deliveredContext.includes(QUEUED_ACTION_CONTEXT_MARKER), true);
    assert.equal(deliveredContext.includes(offered.next_actions[0].title), true);
    assert.equal(contextValue(deliveredContext, "session_id"), rootID);
  } finally {
    // This fixture's graceful shutdown audit expects the separate two-dispatch scenario.
    await server.abort();
    await Promise.allSettled(hookChildren.map((child) => child.completion));
    await rm(server.fixtureRoot, { recursive: true, force: true });
  }
});

test("event navigation selects the third project first and preserves the other sessions", async () => {
  const productBuild = await buildProductCoordinator();
  const server = await startOperationalServer();
  const hookChildren = [];
  const names = ["blabee", "blabase", "biadone"];
  const sessions = names.map((name) => `session_navigation_${name}`);
  const directories = names.map((name) => path.join(server.enabledProjectPath, name));
  const readSnapshot = async () => {
    const response = await udsRequest(server.socketPath, "pet_snapshot", {
      schema_version: "1.0", kind: "blabee_pet_snapshot_request", consumer_heartbeat: true,
    });
    assert.equal(response.ok, true, JSON.stringify(response.error));
    return response.result;
  };
  const callHook = (event, index, fields) => runBuiltBinary(server.build,
    ["hook", event, "--socket", server.socketPath], {
      input: JSON.stringify(hookPayload(event, {
        session_id: sessions[index], cwd: directories[index],
        turn_id: `turn_navigation_${names[index]}`, ...fields,
      })),
    });
  const waitForPermissions = async (count) => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const snapshot = await readSnapshot();
      if (snapshot.permission_requests.length === count) return snapshot;
      await delay(20);
    }
    assert.fail(`expected ${count} pending permissions`);
  };
  const resolvePermission = async (request, index, decision) => {
    const target = {
      schema_version: "1.0", kind: "blabee_permission_resolution_request",
      request_id: request.request_id, project_id: request.project_id,
      session_id: request.session_id, turn_id: request.turn_id,
    };
    const focused = await udsRequest(server.socketPath, "focus_event", {
      schema_version: "1.0", kind: "blabee_pet_event_focus_request", event_kind: "permission", target,
    });
    assert.equal(focused.ok, true, JSON.stringify(focused.error));
    const resolved = await udsRequest(server.socketPath, "resolve_permission_request", {
      ...target, response_id: `response_navigation_${index}`, decision,
    });
    assert.equal(resolved.ok, true, JSON.stringify(resolved.error));
    const completion = await hookChildren[index].completion;
    assert.equal(completion.code, 0, completion.stderr);
    if (decision === "deny") {
      assert.equal(JSON.parse(completion.stdout).hookSpecificOutput.decision.behavior, "deny");
    } else {
      assert.equal(completion.stdout, "");
    }
  };
  try {
    const offers = [];
    for (let index = 0; index < names.length; index += 1) {
      await mkdir(directories[index], { mode: 0o700 });
      const enabled = await udsRequest(server.socketPath, "enable_project", {
        cwd: directories[index], enabled: true,
      });
      assert.equal(enabled.ok, true);
      const submitted = await callHook("UserPromptSubmit", index, {
        prompt: `Synthetic ${names[index]} task`,
      });
      assert.equal(submitted.code, 0, submitted.stderr);
      const context = JSON.parse(submitted.stdout).hookSpecificOutput.additionalContext;
      const ids = Object.fromEntries([
        "project_id", "session_id", "source_turn_id", "source_prompt_id", "episode_id",
        "episode_root_prompt_id", "episode_baseline_checkpoint_id", "correlation_token",
      ].map((key) => [key, contextValue(context, key)]));
      const offered = proposal(ids, `navigation_${names[index]}`);
      offers.push(offered);
      await emitDecision(productBuild, server.socketPath, proposalWrapper(ids, offered));
      const stopped = await callHook("Stop", index, {
        stop_hook_active: false, last_assistant_message: `Synthetic ${names[index]} result`,
      });
      assert.equal(stopped.code, 0, stopped.stderr);
      const deadline = Date.now() + 5_000;
      let ready = false;
      while (Date.now() < deadline) {
        const snapshot = await readSnapshot();
        if (snapshot.interactions.some((entry) => entry.session_id === sessions[index]
            && entry.state === "waiting")) {
          ready = true;
          break;
        }
        await delay(20);
      }
      assert.equal(ready, true, `${names[index]} event did not become ready`);
    }
    const before = await readSnapshot();
    const events = sessions.map((session) => before.interactions.find((entry) => entry.session_id === session));
    assert.equal(new Set(events.map((entry) => entry.project_id)).size, 3);
    assert.deepEqual(before.event_navigation.events, events.map((entry) => ({
      event_kind: "decision", event_id: entry.interaction_id,
    })));

    // Navigation only changes focus; it cannot consume or execute an event.
    const focused = await udsRequest(server.socketPath, "focus_event", {
      schema_version: "1.0", kind: "blabee_pet_event_focus_request", event_kind: "decision",
      target: focusRequest(events[2]),
    });
    assert.equal(focused.ok, true, JSON.stringify(focused.error));
    assert.equal(focused.result.focused, true);
    const browsing = await readSnapshot();
    assert.deepEqual(browsing.event_navigation.focused, {
      event_kind: "decision", event_id: events[2].interaction_id,
    });
    assert.equal(browsing.interactions.filter((entry) => entry.state === "waiting").length, 3);

    // New approvals cannot steal browsed focus. Resolve the third Hook first,
    // then select its ordinary decision while the earlier two Hooks still wait.
    for (let index = 0; index < names.length; index += 1) {
      const child = spawnBuiltBinary(server.build,
        ["hook", "PermissionRequest", "--socket", server.socketPath], {
          input: JSON.stringify(hookPayload("PermissionRequest", {
            session_id: sessions[index], cwd: directories[index],
            turn_id: `turn_navigation_${names[index]}`,
            tool_name: "Bash", tool_input: { command: `fictional-navigation-command-${index}` },
          })),
        });
      child.completion.catch(() => {});
      hookChildren.push(child);
      await waitForPermissions(index + 1);
    }
    const withApprovals = await readSnapshot();
    assert.deepEqual(withApprovals.event_navigation.focused, browsing.event_navigation.focused);
    assert.equal(withApprovals.event_navigation.events.length, 6);
    const permissions = withApprovals.permission_requests;
    await resolvePermission(permissions[2], 2, "deny");
    const remainingApprovals = await waitForPermissions(2);
    assert.deepEqual(remainingApprovals.permission_requests.map((entry) => entry.request_id),
      permissions.slice(0, 2).map((entry) => entry.request_id));
    assert.equal(remainingApprovals.event_navigation.focused, null);
    const refocused = await udsRequest(server.socketPath, "focus_event", {
      schema_version: "1.0", kind: "blabee_pet_event_focus_request", event_kind: "decision",
      target: focusRequest(events[2]),
    });
    assert.equal(refocused.ok, true, JSON.stringify(refocused.error));
    const stale = await udsRequest(server.socketPath, "select", selection(events[0], "navigation_stale"));
    assert.equal(stale.ok, false);
    assert.equal(stale.error.code, "event_focus_mismatch");

    const selected = await udsRequest(server.socketPath, "select", selection(events[2], "navigation_third"));
    assert.equal(selected.ok, true, JSON.stringify(selected.error));
    const afterSelection = await readSnapshot();
    assert.equal(afterSelection.permission_requests.length, 2);
    for (const earlier of events.slice(0, 2)) {
      assert.equal(afterSelection.interactions.find((entry) => entry.interaction_id === earlier.interaction_id)?.state,
        "waiting", "selecting the third project must not consume an earlier project");
    }
    await resolvePermission(permissions[0], 0, "defer_to_codex");
    await waitForPermissions(1);
    await resolvePermission(permissions[1], 1, "defer_to_codex");
    await waitForPermissions(0);
    const message = legacyQueuedPrompt(selected.result.outcome.continuation_id, directories[2]);
    const misplaced = await callHook("UserPromptSubmit", 0, {
      turn_id: "turn_navigation_wrong_session", prompt: message,
    });
    assert.equal(misplaced.code, 0, misplaced.stderr);
    assert.equal(misplaced.stdout.includes(QUEUED_ACTION_CONTEXT_MARKER), false);
    const delivered = await callHook("UserPromptSubmit", 2, {
      turn_id: "turn_navigation_correct_session", prompt: message,
    });
    assert.equal(delivered.code, 0, delivered.stderr);
    const deliveredContext = JSON.parse(delivered.stdout).hookSpecificOutput.additionalContext;
    assert.equal(deliveredContext.includes(QUEUED_ACTION_CONTEXT_MARKER), true);
    assert.equal(deliveredContext.includes(offers[2].next_actions[0].title), true);
    assert.equal(contextValue(deliveredContext, "session_id"), sessions[2]);
  } finally {
    await server.abort();
    await Promise.allSettled(hookChildren.map((child) => child.completion));
    await rm(server.fixtureRoot, { recursive: true, force: true });
  }
});

test("managed Codex live trust pins once, execs fallback exactly, and reaps the inherited pin", async () => {
  const build = await buildCoordinator();
  const canonicalTemporaryDirectory = await realpath(tmpdir());
  const fixtureRoot = await mkdtemp(
    path.join(canonicalTemporaryDirectory, "blabee-managed-fallback-"),
  );
  await chmod(fixtureRoot, 0o700);
  const runtimePath = path.join(fixtureRoot, "official-runtime");
  const binPath = path.join(runtimePath, "bin");
  const codexPath = path.join(runtimePath, "codex-path");
  const homePath = path.join(fixtureRoot, "home");
  const pinPath = path.join(fixtureRoot, "pins");
  await mkdir(runtimePath, { mode: 0o700 });
  await Promise.all([
    mkdir(binPath, { mode: 0o700 }),
    mkdir(codexPath, { mode: 0o700 }),
    mkdir(homePath, { mode: 0o700 }),
    mkdir(pinPath, { mode: 0o700 }),
  ]);
  const candidatePath = path.join(binPath, "codex");
  const hostPath = path.join(binPath, "codex-code-mode-host");
  const rgPath = path.join(codexPath, "rg");
  const manifestPath = path.join(runtimePath, "codex-package.json");
  const markerPath = path.join(pinPath, "fallback-result.json");
  const releasePath = path.join(pinPath, "fallback-release");
  await Promise.all([
    cp(build.binaryPath, candidatePath),
    cp(build.binaryPath, hostPath),
    cp(build.binaryPath, rgPath),
  ]);
  await Promise.all([
    chmod(candidatePath, 0o500),
    chmod(hostPath, 0o500),
    chmod(rgPath, 0o500),
    writeFile(manifestPath, JSON.stringify({
      entrypoint: "bin/codex",
      layoutVersion: 1,
      pathDir: "codex-path",
      target: process.arch === "arm64"
        ? "aarch64-apple-darwin"
        : "x86_64-apple-darwin",
      variant: "codex",
      version: "0.150.1",
    }), { mode: 0o400 }),
  ]);
  const environment = {
    PATH: binPath,
    HOME: homePath,
    TMPDIR: `${pinPath}${path.sep}`,
    NVM_BIN: "",
    ASDF_DATA_DIR: "",
    VOLTA_HOME: "",
    BLABEE_COORDINATOR_BINARY: "/private/untrusted/coordinator",
    BLABEE_SOCKET: "/private/untrusted/socket",
    BLABEE_MANAGED_APPROVALS: "1",
    BLABEE_MANAGED_CODEX_AUTH_TOKEN: "must-not-survive",
    BLABEE_RUNTIME_IDENTITY: "must-not-survive",
    BLABEE_TEST_SAFE_ENVIRONMENT: "preserved",
    BLABEE_TEST_FALLBACK_RELEASE: releasePath,
  };

  let fallbackRun;
  try {
    const forwarded = ["argument with spaces", "--literal=$()"];
    fallbackRun = spawnBuiltBinary(
      build,
      [
        "managed-codex-fallback-test",
        "--marker", markerPath,
        "--",
        ...forwarded,
      ],
      { cwd: fixtureRoot, environment, timeoutMs: 20_000 },
    );
    const result = JSON.parse(await Promise.race([
      readFileEventually(markerPath),
      fallbackRun.completion.then((outcome) => {
        fallbackRun = undefined;
        assert.fail(
          `managed fallback exited before writing its marker: ${JSON.stringify(outcome)}`,
        );
      }),
    ]));
    const pinnedPath = result.argv[0];
    const pinnedDirectory = path.dirname(path.dirname(pinnedPath));
    assert.equal(fallbackRun.child.exitCode, null);
    assert.equal(result.cwd, fixtureRoot);
    assert.deepEqual(result.forwarded, forwarded);
    assert.equal(result.safe_environment, "preserved");
    assert.equal(
      result.code_mode_host_path,
      path.join(path.dirname(pinnedPath), "codex-code-mode-host"),
    );
    assert.deepEqual(result.stripped_environment_still_present, []);
    assert.deepEqual(result.argv.slice(1, 3), [
      "managed-codex-fallback-test-target",
      "--marker",
    ]);
    assert.equal(await realpath(result.argv[3]), await realpath(markerPath));
    assert.deepEqual(result.argv.slice(4), [
      "--",
      ...forwarded,
    ]);
    assert.equal(await realpath(path.dirname(pinnedDirectory)), pinPath);
    assert.match(path.basename(pinnedDirectory), /^blabee-managed-codex\./);
    assert.equal((await stat(pinnedDirectory)).mode & 0o777, 0o700);
    assert.equal((await stat(pinnedPath)).mode & 0o777, 0o500);

    const old = new Date(Date.now() - 120_000);
    await utimes(pinnedDirectory, old, old);
    const liveQualification = await runBuiltBinary(
      build,
      ["managed-codex-qualification-test"],
      { cwd: fixtureRoot, environment, timeoutMs: 20_000 },
    );
    assert.deepEqual(
      {
        code: liveQualification.code,
        signal: liveQualification.signal,
        stderr: liveQualification.stderr,
      },
      { code: 0, signal: null, stderr: "" },
    );
    assert.equal((await stat(pinnedDirectory)).mode & 0o777, 0o700);

    await writeFile(releasePath, "release\n", { mode: 0o600 });
    const fallback = await fallbackRun.completion;
    fallbackRun = undefined;
    assert.deepEqual(
      { code: fallback.code, signal: fallback.signal, stderr: fallback.stderr },
      { code: 37, signal: null, stderr: "" },
    );

    await utimes(pinnedDirectory, old, old);
    const finalQualification = await runBuiltBinary(
      build,
      ["managed-codex-qualification-test"],
      { cwd: fixtureRoot, environment, timeoutMs: 20_000 },
    );
    assert.deepEqual(
      {
        code: finalQualification.code,
        signal: finalQualification.signal,
        stderr: finalQualification.stderr,
      },
      { code: 0, signal: null, stderr: "" },
    );
    await assert.rejects(
      stat(pinnedDirectory),
      (error) => error?.code === "ENOENT",
    );
  } finally {
    if (fallbackRun?.child.exitCode === null && fallbackRun?.child.signalCode === null) {
      fallbackRun.child.kill("SIGKILL");
      await fallbackRun.completion.catch(() => {});
    }
    await rm(fixtureRoot, { force: true, recursive: true });
  }
});

test("real Hook, MCP, Pet, UDS, SQLite flow late-attaches and queues two next turns without leakage", async () => {
  const server = await startOperationalServer();
  const productBuild = await buildProductCoordinator();
  const productBinary = await readFile(productBuild.binaryPath);
  assert.equal(
    productBinary.includes(Buffer.from("operational-roundtrip-test-server")),
    false,
    "the integration server mode must be compiled out of the product binary",
  );
  assert.equal(
    productBinary.includes(Buffer.from("claude-bridge-roundtrip-test-server")),
    false,
    "the Claude ingress fixture must be compiled out of the product binary",
  );
  assert.equal(
    productBinary.includes(Buffer.from("claude-session-host-test")),
    false,
    "the Claude native-session fixture must be compiled out of the product binary",
  );
  assert.equal(
    productBinary.includes(Buffer.from("managed-codex-fallback-test")),
    false,
    "the managed Codex fallback fixture must be compiled out of the product binary",
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

    const firstQueuedPrompt = legacyQueuedPrompt(
      firstSelection.result.outcome.continuation_id,
      server.enabledProjectPath,
    );
    assertLegacyQueuedPrompt(firstQueuedPrompt, {
      action: firstProposal.next_actions[0],
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
    const canonicalFirstAction = canonicalJSON(firstProposal.next_actions[0]);
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
      canonicalJSONObject(firstProposal.next_actions[0]),
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
    const secondQueuedPrompt = legacyQueuedPrompt(
      secondSelection.result.outcome.continuation_id,
      server.enabledProjectPath,
    );
    assertLegacyQueuedPrompt(secondQueuedPrompt, {
      action: secondProposal.next_actions[0],
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

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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
    env: { ...build.environment, ...environment },
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
    { env: build.environment, stdio: ["ignore", "pipe", "pipe"] },
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
      assert.deepEqual(termination, { code: 0, signal: null });
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
      socket.write(`${JSON.stringify({ request_id, type, payload })}\n`);
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

test("real Hook, MCP, Pet, UDS, SQLite operational flow completes two boundaries without token leakage", async () => {
  const server = await startOperationalServer();
  const productBuild = await buildProductCoordinator();
  const productBinary = await readFile(productBuild.binaryPath);
  assert.equal(
    productBinary.includes(Buffer.from("operational-roundtrip-test-server")),
    false,
    "the integration server mode must be compiled out of the product binary",
  );
  const adapters = new Set();
  let stopped = false;
  try {
    const sessionStart = await runBuiltBinary(
      productBuild,
      ["hook", "SessionStart", "--socket", server.socketPath],
      {
        input: JSON.stringify(hookPayload("SessionStart", {
          cwd: server.enabledProjectPath,
          source: "startup",
        })),
      },
    );
    assert.deepEqual(
      { code: sessionStart.code, signal: sessionStart.signal, stderr: sessionStart.stderr },
      { code: 0, signal: null, stderr: "" },
    );
    const sessionOutput = JSON.parse(sessionStart.stdout);
    assert.equal(sessionOutput.hookSpecificOutput.hookEventName, "SessionStart");

    const userPrompt = await runBuiltBinary(
      productBuild,
      ["hook", "UserPromptSubmit", "--socket", server.socketPath],
      {
        input: JSON.stringify(hookPayload("UserPromptSubmit", {
          cwd: server.enabledProjectPath,
          turn_id: "turn_operational_roundtrip",
          prompt: "Run the real operational roundtrip",
        })),
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
      "correlation_token",
    ].map((key) => [key, contextValue(designatedContext, key)]));
    assert.equal(userPrompt.stdout.split(ids.correlation_token).length - 1, 1);

    const firstMCP = await emitDecision(
      productBuild,
      server.socketPath,
      proposalWrapper(ids, proposal(ids, "one")),
    );
    assert.equal(firstMCP.response.accepted, true);
    assert.equal(firstMCP.response.staged, false);
    assert.equal(firstMCP.response.packet.boundary_sequence, 1);

    const firstStop = spawnBuiltBinary(
      productBuild,
      ["hook", "Stop", "--socket", server.socketPath],
      {
        input: JSON.stringify(hookPayload("Stop", {
          cwd: server.enabledProjectPath,
          turn_id: ids.source_turn_id,
          stop_hook_active: false,
          last_assistant_message: "boundary one ready",
        })),
      },
    );
    adapters.add(firstStop);
    const firstWaiting = await waitForInteraction(server.socketPath, 1);
    assert.equal(firstStop.child.exitCode, null);
    const firstSelection = await udsRequest(
      server.socketPath,
      "select",
      selection(firstWaiting.interaction, 1),
    );
    assert.equal(firstSelection.ok, true);
    assert.equal(firstSelection.result.accepted, true);
    assert.equal(firstSelection.result.outcome.kind, "continuation");
    const firstBlock = await firstStop.completion;
    adapters.delete(firstStop);
    assert.deepEqual(
      { code: firstBlock.code, signal: firstBlock.signal, stderr: firstBlock.stderr },
      { code: 0, signal: null, stderr: "" },
    );
    assert.equal(JSON.parse(firstBlock.stdout).decision, "block");

    const secondMCP = await emitDecision(
      productBuild,
      server.socketPath,
      proposalWrapper(ids, proposal(ids, "two")),
    );
    assert.deepEqual(secondMCP.response, {
      accepted: true,
      boundary_sequence: 2,
      proposal_id: "proposal_operational_two",
      staged: true,
    });

    const secondStop = spawnBuiltBinary(
      productBuild,
      ["hook", "Stop", "--socket", server.socketPath],
      {
        input: JSON.stringify(hookPayload("Stop", {
          cwd: server.enabledProjectPath,
          turn_id: ids.source_turn_id,
          stop_hook_active: true,
          last_assistant_message: "boundary one continuation returned",
        })),
      },
    );
    adapters.add(secondStop);
    const secondWaiting = await waitForInteraction(server.socketPath, 2);
    assert.equal(secondStop.child.exitCode, null);
    assert.equal(
      secondWaiting.response.result.interactions.some(
        (interaction) => interaction.boundary_sequence === 1,
      ),
      false,
    );
    const secondSelection = await udsRequest(
      server.socketPath,
      "select",
      selection(secondWaiting.interaction, 2),
    );
    assert.equal(secondSelection.ok, true);
    assert.equal(secondSelection.result.outcome.kind, "continuation");
    const secondBlock = await secondStop.completion;
    adapters.delete(secondStop);
    assert.deepEqual(
      { code: secondBlock.code, signal: secondBlock.signal, stderr: secondBlock.stderr },
      { code: 0, signal: null, stderr: "" },
    );
    assert.equal(JSON.parse(secondBlock.stdout).decision, "block");

    const finalStop = await runBuiltBinary(
      productBuild,
      ["hook", "Stop", "--socket", server.socketPath],
      {
        input: JSON.stringify(hookPayload("Stop", {
          cwd: server.enabledProjectPath,
          turn_id: ids.source_turn_id,
          stop_hook_active: true,
          last_assistant_message: "boundary two continuation returned",
        })),
      },
    );
    assert.deepEqual(finalStop, {
      code: 0,
      signal: null,
      stderr: "",
      stdout: "",
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
      firstMCP.result.stdout,
      firstMCP.result.stderr,
      JSON.stringify(firstWaiting.response),
      JSON.stringify(firstSelection),
      firstBlock.stdout,
      firstBlock.stderr,
      secondMCP.result.stdout,
      secondMCP.result.stderr,
      JSON.stringify(secondWaiting.response),
      JSON.stringify(secondSelection),
      secondBlock.stdout,
      secondBlock.stderr,
      finalStop.stdout,
      finalStop.stderr,
      JSON.stringify(finalState),
    ].join("\n");
    assert.equal(publicOutputWithoutDesignatedContext.includes(ids.correlation_token), false);
    assert.equal(publicOutputWithoutDesignatedContext.includes('"correlation_token"'), false);
    assert.equal(publicOutputWithoutDesignatedContext.includes('"continuation_token"'), false);
    assert.equal(designatedContext.includes(ids.correlation_token), true);

    const storageBytes = await readStorageArtifacts(server.databasePath);
    assert.equal(storageBytes.includes(Buffer.from(ids.correlation_token)), false);
    assert.equal(storageBytes.includes(Buffer.from('"correlation_token"')), false);
    assert.equal(storageBytes.includes(Buffer.from('"continuation_token":')), false);

    await server.stop();
    stopped = true;
  } finally {
    for (const adapter of adapters) {
      if (adapter.child.exitCode === null && adapter.child.signalCode === null) {
        adapter.child.kill("SIGKILL");
      }
    }
    if (!stopped) await server.abort();
    await rm(server.fixtureRoot, { force: true, recursive: true });
  }
});

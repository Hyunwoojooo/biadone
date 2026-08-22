import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { after, test } from "node:test";
import { tmpdir } from "node:os";

import {
  buildCoordinator,
  buildProductCoordinator,
  cleanupCoordinatorBuild,
  CONTRACTS_ROOT,
} from "../CoordinatorPersistence/runtime-harness.mjs";

const proposal = JSON.parse(await readFile(
  new URL("../../Fixtures/v1/contracts/valid/decision-proposal.json", import.meta.url),
  "utf8",
));
const operationalProposalKeys = [
  "schema_version",
  "interaction_kind",
  "proposal_id",
  "correlation_token",
  "task_goal",
  "outcome",
  "recommended_next",
  "alternative_next",
  "pause_capsule",
  "reported_side_effects",
];
const operationalProposal = Object.fromEntries(
  operationalProposalKeys.map((key) => [key, proposal[key]]),
);

function hookPayload(hook_event_name, eventFields = {}) {
  return {
    session_id: "session_hook_fixture",
    transcript_path: "/tmp/fictional-blabee-transcript.jsonl",
    cwd: "/tmp/fictional-blabee-project",
    permission_mode: "default",
    hook_event_name,
    ...eventFields,
  };
}

after(async () => {
  await cleanupCoordinatorBuild();
});

async function startFakeCoordinator(handler) {
  const directory = await mkdtemp(path.join(tmpdir(), "blabee-t011-uds-client-"));
  await chmod(directory, 0o700);
  const socketPath = path.join(directory, "blabee.sock");
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on("data", async (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > 1_048_576) {
        socket.destroy();
        return;
      }
      const newline = buffer.indexOf(0x0a);
      if (newline < 0) return;
      socket.pause();
      try {
        const request = JSON.parse(buffer.subarray(0, newline).toString("utf8"));
        const result = await handler(request);
        socket.end(`${JSON.stringify({
          request_id: request.request_id,
          ok: true,
          result,
        })}\n`);
      } catch {
        socket.destroy();
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  await chmod(socketPath, 0o600);
  return {
    socketPath,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await rm(directory, { force: true, recursive: true });
    },
  };
}

async function runBinary(arguments_, { environment = {}, input = "", timeoutMs = 15_000 } = {}) {
  const build = await buildProductCoordinator();
  return await runBuiltBinary(build, arguments_, { environment, input, timeoutMs });
}

async function runBuiltBinary(
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
  const exit = await new Promise((resolve, reject) => {
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
      resolve({ code, signal });
    });
  });
  return {
    ...exit,
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
  };
}

async function startFixtureTransportServer({
  authorityDatabasePath,
  authorityRootPath,
  directory: existingDirectory,
  socketName = "blabee.sock",
} = {}) {
  const build = await buildCoordinator();
  const directory = existingDirectory
    ?? await mkdtemp(path.join(tmpdir(), "blabee-t011-uds-server-"));
  if (!existingDirectory) await chmod(directory, 0o700);
  const socketPath = path.join(directory, socketName);
  const arguments_ = ["transport-test-server", "--socket", socketPath];
  if (authorityDatabasePath || authorityRootPath) {
    assert.ok(authorityDatabasePath && authorityRootPath);
    arguments_.push(
      "--authority-database", authorityDatabasePath,
      "--authority-root", authorityRootPath,
    );
  }
  const child = spawn(
    build.binaryPath,
    arguments_,
    { env: build.environment, stdio: ["ignore", "pipe", "pipe"] },
  );
  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  child.stdout.setEncoding("utf8");
  await new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("fixture UDS server did not become ready"));
    }, 15_000);
    const onExit = (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(
        `fixture UDS server exited before ready (code=${code}, signal=${signal}, stderr=${Buffer.concat(stderr)})`,
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
    directory,
    socketPath,
    async close() {
      const termination = await new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve({ code: child.exitCode, signal: child.signalCode });
          return;
        }
        const timeout = setTimeout(() => child.kill("SIGKILL"), 3_000);
        child.once("exit", (code, signal) => {
          clearTimeout(timeout);
          resolve({ code, signal });
        });
        child.kill("SIGTERM");
      });
      assert.deepEqual(termination, { code: 0, signal: null });
      assert.equal(Buffer.concat(stderr).toString("utf8"), "");
      await assert.rejects(stat(socketPath), (error) => error?.code === "ENOENT");
      await rm(directory, { force: true, recursive: true });
    },
  };
}

function udsRequest(socketPath, type, payload = {}) {
  return new Promise((resolve, reject) => {
    const request_id = `request_fixture_${Math.random().toString(16).slice(2)}`;
    const socket = net.createConnection(socketPath);
    let buffer = "";
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("fixture UDS request timed out"));
    }, 5_000);
    socket.setEncoding("utf8");
    socket.once("connect", () => {
      socket.write(`${JSON.stringify({ request_id, type, payload })}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timeout);
      socket.destroy();
      try {
        const response = JSON.parse(buffer.slice(0, newline));
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

function udsRequestExpectingClosedWithoutResponse(socketPath, type, payload) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("poisoning request did not close"));
    }, 2_000);
    socket.once("connect", () => {
      socket.write(`${JSON.stringify({
        request_id: "request_fixture_poison",
        type,
        payload,
      })}\n`);
    });
    socket.once("data", () => {
      clearTimeout(timeout);
      socket.destroy();
      reject(new Error("request-local secret was echoed in a UDS response"));
    });
    socket.once("end", () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function openHoldingConnection(socketPath) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    socket.once("connect", () => {
      socket.write("{");
      resolve(socket);
    });
    socket.once("error", reject);
  });
}

function waitForSocketClose(socket, timeoutMs = 2_000) {
  return new Promise((resolve, reject) => {
    if (socket.destroyed) {
      resolve();
      return;
    }
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("over-capacity connection was not closed"));
    }, timeoutMs);
    socket.once("close", () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once("error", () => {
      // A reset is also a fail-closed rejection by the admission gate.
    });
  });
}

function udsRawLine(socketPath, line) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = "";
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("raw UDS request timed out"));
    }, 5_000);
    socket.setEncoding("utf8");
    socket.once("connect", () => socket.write(line));
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timeout);
      socket.destroy();
      try {
        resolve(JSON.parse(buffer.slice(0, newline)));
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

test("Hook forwards official input and emits only official additionalContext output", async () => {
  const payload = hookPayload("SessionStart", { source: "startup" });
  const fake = await startFakeCoordinator((request) => {
    assert.match(request.request_id, /^request_[0-9a-f-]+$/);
    assert.equal(request.type, "session_start");
    assert.deepEqual(request.payload, payload);
    return { enabled: true, additionalContext: "Blabee project binding is active." };
  });
  try {
    const result = await runBinary(
      ["hook", "SessionStart"],
      {
        environment: { BLABEE_SOCKET: fake.socketPath },
        input: JSON.stringify(payload),
      },
    );
    assert.deepEqual({ code: result.code, signal: result.signal }, { code: 0, signal: null });
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: "Blabee project binding is active.",
      },
    });
  } finally {
    await fake.close();
  }
});

test("all Hook events forward official-shaped payloads and map exact public outputs", async () => {
  const assistantMessage = "sensitive assistant message must not reach adapter output";
  const payloads = {
    UserPromptSubmit: hookPayload("UserPromptSubmit", {
      prompt: "Continue the fictional implementation.",
    }),
    PermissionRequest: hookPayload("PermissionRequest", {
      tool_name: "Bash",
      tool_input: { cmd: "fictional-read-only-command" },
    }),
    StopBlock: hookPayload("Stop", {
      turn_id: "turn_hook_block",
      stop_hook_active: false,
      last_assistant_message: assistantMessage,
    }),
    StopNoDecision: hookPayload("Stop", {
      turn_id: "turn_hook_idle",
      stop_hook_active: true,
      last_assistant_message: assistantMessage,
    }),
  };
  const received = [];
  const fake = await startFakeCoordinator((request) => {
    received.push({ type: request.type, payload: request.payload });
    if (request.type === "user_prompt_submit") {
      return { enabled: true, additionalContext: "Prompt episode bound." };
    }
    if (request.type === "permission_request") {
      return { enabled: true, decision: "block", reason: "must remain hidden" };
    }
    if (request.type === "stop" && request.payload.turn_id === "turn_hook_block") {
      return { enabled: true, decision: "block", reason: "Run the reviewed next action." };
    }
    return { enabled: true, status: "no_decision" };
  });
  try {
    const userPrompt = await runBinary(
      ["hook", "UserPromptSubmit", "--socket", fake.socketPath],
      { input: JSON.stringify(payloads.UserPromptSubmit) },
    );
    assert.deepEqual(JSON.parse(userPrompt.stdout), {
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: "Prompt episode bound.",
      },
    });

    const permission = await runBinary(
      ["hook", "PermissionRequest", "--socket", fake.socketPath],
      { input: JSON.stringify(payloads.PermissionRequest) },
    );
    assert.deepEqual(
      { code: permission.code, stderr: permission.stderr, stdout: permission.stdout },
      { code: 0, stderr: "", stdout: "" },
    );

    const stopBlock = await runBinary(
      ["hook", "Stop", "--socket", fake.socketPath],
      { input: JSON.stringify(payloads.StopBlock) },
    );
    assert.deepEqual(JSON.parse(stopBlock.stdout), {
      decision: "block",
      reason: "Run the reviewed next action.",
    });

    const stopNoDecision = await runBinary(
      ["hook", "Stop", "--socket", fake.socketPath],
      { input: JSON.stringify(payloads.StopNoDecision) },
    );
    assert.deepEqual(
      {
        code: stopNoDecision.code,
        stderr: stopNoDecision.stderr,
        stdout: stopNoDecision.stdout,
      },
      { code: 0, stderr: "", stdout: "" },
    );

    assert.deepEqual(received, [
      { type: "user_prompt_submit", payload: payloads.UserPromptSubmit },
      { type: "permission_request", payload: payloads.PermissionRequest },
      { type: "stop", payload: payloads.StopBlock },
      { type: "stop", payload: payloads.StopNoDecision },
    ]);
    for (const result of [userPrompt, permission, stopBlock, stopNoDecision]) {
      assert.equal(result.stdout.includes(assistantMessage), false);
      assert.equal(result.stderr.includes(assistantMessage), false);
    }
  } finally {
    await fake.close();
  }
});

test("Hook transport failure exits zero with empty stdout and stderr", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "blabee-t011-no-socket-"));
  await chmod(directory, 0o700);
  try {
    const result = await runBinary(
      ["hook", "Stop", "--socket", path.join(directory, "missing.sock")],
      { input: JSON.stringify({ stop_hook_active: true, turn_id: "turn_missing" }) },
    );
    assert.deepEqual(result, { code: 0, signal: null, stderr: "", stdout: "" });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("explicit and environment socket overrides reject relative paths", async () => {
  const explicit = await runBinary(["mcp", "--socket", "relative.sock"]);
  assert.equal(explicit.code, 1);
  assert.equal(explicit.signal, null);
  assert.match(explicit.stderr, /operational_socket_invalid/);

  const environment = await runBinary(
    ["mcp"],
    { environment: { BLABEE_SOCKET: "relative.sock" } },
  );
  assert.equal(environment.code, 1);
  assert.equal(environment.signal, null);
  assert.match(environment.stderr, /operational_socket_invalid/);

  const enabledProject = await runBinary([
    "daemon",
    "--database", "/tmp/blabee-relative-project-check.sqlite3",
    "--key", "/tmp/blabee-relative-project-check.key",
    "--contracts", "/tmp/blabee-relative-project-contracts",
    "--socket", "/tmp/blabee-relative-project-check.sock",
    "--enabled-project", "relative-project",
  ]);
  assert.equal(enabledProject.code, 1);
  assert.equal(enabledProject.signal, null);
  assert.match(enabledProject.stderr, /invalid_arguments/);
});

test("Hook accepted by a silent daemon still fails open within the command budget", async () => {
  const fake = await startFakeCoordinator(
    () => new Promise(() => {}),
  );
  try {
    const startedAt = Date.now();
    const result = await runBinary(
      ["hook", "SessionStart", "--socket", fake.socketPath],
      { input: JSON.stringify(hookPayload("SessionStart", { source: "startup" })) },
    );
    const elapsed = Date.now() - startedAt;
    assert.deepEqual(result, { code: 0, signal: null, stderr: "", stdout: "" });
    assert.ok(elapsed >= 4_500, `silent-daemon timeout returned too early: ${elapsed}ms`);
    assert.ok(elapsed < 8_000, `silent-daemon timeout exceeded Hook budget: ${elapsed}ms`);
  } finally {
    await fake.close();
  }
});

test("MCP exposes the complete proposal schema and never echoes correlation tokens", async () => {
  let forwardedCalls = 0;
  const fake = await startFakeCoordinator((request) => {
    forwardedCalls += 1;
    assert.equal(request.type, "emit_decision");
    assert.deepEqual(request.payload.proposal, operationalProposal);
    return { accepted: true, status: "waiting_for_selection" };
  });
  const arguments_ = {
    project_id: proposal.project_id,
    session_id: proposal.session_id,
    source_turn_id: proposal.source_turn_id,
    source_prompt_id: proposal.source_prompt_id,
    episode_id: proposal.episode_id,
    correlation_token: proposal.correlation_token,
    proposal: operationalProposal,
  };
  const messages = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "blabee-test-client", version: "0.1.0" },
      },
    },
    { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "emit_decision", arguments: arguments_ },
    },
    {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "emit_decision",
        arguments: {
          ...arguments_,
          proposal: { ...operationalProposal, forbidden_extra: true },
        },
      },
    },
  ];
  try {
    const result = await runBinary(
      ["mcp", "--socket", fake.socketPath],
      { input: `${messages.map((message) => JSON.stringify(message)).join("\n")}\n` },
    );
    assert.deepEqual({ code: result.code, signal: result.signal }, { code: 0, signal: null });
    assert.equal(result.stderr, "");
    const responses = result.stdout.trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(responses.length, 4);
    assert.equal(responses[0].result.protocolVersion, "2025-06-18");
    const tool = responses[1].result.tools[0];
    assert.equal(tool.name, "emit_decision");
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.inputSchema.properties.proposal.additionalProperties, false);
    for (const required of [
      "proposal_id",
      "alternative_next",
      "pause_capsule",
      "reported_side_effects",
    ]) {
      assert.equal(tool.inputSchema.properties.proposal.required.includes(required), true);
    }
    assert.deepEqual(
      tool.inputSchema.properties.proposal.properties.outcome.required,
      ["status", "summary"],
    );
    assert.deepEqual(
      tool.inputSchema.properties.proposal.properties.recommended_next.required,
      ["title", "objective", "constraints", "done_when"],
    );
    assert.deepEqual(responses[2].result.structuredContent, {
      accepted: true,
      status: "waiting_for_selection",
    });
    assert.equal(responses[3].result.isError, true);
    assert.equal(forwardedCalls, 1, "invalid exact-key wrappers must not reach UDS");
    assert.equal(result.stdout.includes(proposal.correlation_token), false);
  } finally {
    await fake.close();
  }
});

test("MCP transport failure is a generic isError result without raw payload", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "blabee-t011-mcp-missing-"));
  await chmod(directory, 0o700);
  const arguments_ = {
    project_id: proposal.project_id,
    session_id: proposal.session_id,
    source_turn_id: proposal.source_turn_id,
    source_prompt_id: proposal.source_prompt_id,
    episode_id: proposal.episode_id,
    correlation_token: proposal.correlation_token,
    proposal: operationalProposal,
  };
  try {
    const result = await runBinary(
      ["mcp", "--socket", path.join(directory, "missing.sock")],
      {
        input: `${JSON.stringify({
          jsonrpc: "2.0",
          id: "missing_transport",
          method: "tools/call",
          params: { name: "emit_decision", arguments: arguments_ },
        })}\n`,
      },
    );
    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    const response = JSON.parse(result.stdout);
    assert.equal(response.result.isError, true);
    assert.equal(result.stdout.includes(proposal.correlation_token), false);
    assert.equal(result.stdout.includes(proposal.task_goal), false);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("UDS server enforces one owner, secure modes, and the high-level allowlist", async () => {
  const fixture = await startFixtureTransportServer();
  try {
    const [directoryInfo, socketInfo, lockInfo] = await Promise.all([
      stat(fixture.directory),
      stat(fixture.socketPath),
      stat(`${fixture.socketPath}.lock`),
    ]);
    assert.equal(directoryInfo.mode & 0o777, 0o700);
    assert.equal(socketInfo.mode & 0o777, 0o600);
    assert.equal(lockInfo.mode & 0o777, 0o600);

    const second = await runBuiltBinary(
      fixture.build,
      ["transport-test-server", "--socket", fixture.socketPath],
      { timeoutMs: 5_000 },
    );
    assert.equal(second.code, 1);
    assert.equal(second.signal, null);

    await udsRequestExpectingClosedWithoutResponse(fixture.socketPath, "get_state", {
      correlation_token: "request_id",
    });
    const stillAlive = await udsRequest(fixture.socketPath, "get_state");
    assert.equal(stillAlive.ok, true);
    assert.equal(stillAlive.result.fixture, "ok");

    const focusAccepted = await udsRequest(fixture.socketPath, "focus_interaction", {});
    assert.equal(focusAccepted.ok, true);
    assert.equal(focusAccepted.result.handled_type, "focus_interaction");

    const rejected = await udsRequest(fixture.socketPath, "execute_command", {
      command: { op: "unsafe_low_level" },
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.code, "operational_request_invalid");
    assert.equal(rejected.error.message, "request failed");
  } finally {
    await fixture.close();
  }
});

test("one storage authority rejects a second daemon using a different socket", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "blabee-t011-authority-"));
  await chmod(directory, 0o700);
  const authorityRootPath = await mkdtemp("/tmp/blabee-t011-authority-root-");
  await chmod(authorityRootPath, 0o700);
  const authorityDatabasePath = path.join(directory, "storage", "coordinator.sqlite3");
  const first = await startFixtureTransportServer({
    authorityDatabasePath,
    authorityRootPath,
    directory,
    socketName: "first.sock",
  });
  try {
    const second = await runBuiltBinary(
      first.build,
      [
        "transport-test-server",
        "--socket", path.join(directory, "second.sock"),
        "--authority-database", authorityDatabasePath,
        "--authority-root", authorityRootPath,
      ],
      { timeoutMs: 5_000 },
    );
    assert.equal(second.code, 1);
    assert.equal(second.signal, null);
    await assert.rejects(
      stat(path.join(directory, "second.sock")),
      (error) => error?.code === "ENOENT",
    );
    const stillAlive = await udsRequest(first.socketPath, "get_state");
    assert.equal(stillAlive.ok, true);

    // Exercise the exact legacy entry point with its harness-only authority
    // gate. It must fail before Keychain or SQLite access, without inheriting
    // HOME as part of the authority identity.
    const keyPath = path.join(directory, "unused-keys", "coordinator.key");
    const legacy = await runBuiltBinary(
      first.build,
      [
        "--database", authorityDatabasePath,
        "--key", keyPath,
        "--contracts", CONTRACTS_ROOT,
      ],
      {
        environment: {
          BLABEE_T011_ENABLE_AUTHORITY_TEST_LEASE: "1",
          BLABEE_T011_AUTHORITY_TEST_ROOT: authorityRootPath,
          HOME: "/tmp/blabee-t011-different-home",
        },
        timeoutMs: 5_000,
      },
    );
    assert.equal(legacy.code, 1);
    assert.equal(legacy.signal, null);
    assert.match(legacy.stderr, /operational_owner_active/);
    await assert.rejects(
      stat(authorityDatabasePath),
      (error) => error?.code === "ENOENT",
    );
    await assert.rejects(
      stat(keyPath),
      (error) => error?.code === "ENOENT",
    );
    await assert.rejects(
      stat(path.dirname(authorityDatabasePath)),
      (error) => error?.code === "ENOENT",
      "authority acquisition must not create the database parent",
    );
    const authorityEntries = await readdir(authorityRootPath);
    assert.equal(authorityEntries.length, 1);
    assert.equal(authorityEntries.filter((name) => /^db-[0-9a-f]{64}\.lock$/.test(name)).length, 1);
    for (const entry of authorityEntries) {
      const info = await stat(path.join(authorityRootPath, entry));
      assert.equal(info.mode & 0o777, 0o600);
    }

    // A different database in the same secure parent has an independent
    // authority identity and must not be over-serialized.
    const alternateRuntime = await mkdtemp("/tmp/blabee-t011-alt-");
    await chmod(alternateRuntime, 0o700);
    const independent = await startFixtureTransportServer({
      authorityDatabasePath: path.join(directory, "storage", "independent.sqlite3"),
      authorityRootPath,
      directory: alternateRuntime,
    });
    try {
      const independentAuthorityEntries = await readdir(authorityRootPath);
      assert.equal(independentAuthorityEntries.length, 2);
      assert.equal(
        independentAuthorityEntries.filter((name) => /^db-[0-9a-f]{64}\.lock$/.test(name)).length,
        2,
      );
      const independentState = await udsRequest(independent.socketPath, "get_state");
      assert.equal(independentState.ok, true);
      const originalState = await udsRequest(first.socketPath, "get_state");
      assert.equal(originalState.ok, true);
    } finally {
      await independent.close();
    }
  } finally {
    await first.close();
    await rm(authorityRootPath, { force: true, recursive: true });
  }
});

test("a suspended Stop connection does not block concurrent UDS requests or scheduler work", async () => {
  const fixture = await startFixtureTransportServer();
  try {
    const completionOrder = [];
    const slow = udsRequest(fixture.socketPath, "stop", { fixture_delay_ms: 400 })
      .then((response) => {
        completionOrder.push("slow");
        return response;
      });
    await new Promise((resolve) => setTimeout(resolve, 40));
    const fast = udsRequest(fixture.socketPath, "get_state").then((response) => {
      completionOrder.push("fast");
      return response;
    });
    const [slowResponse, fastResponse] = await Promise.all([slow, fast]);
    assert.deepEqual(completionOrder, ["fast", "slow"]);
    assert.equal(slowResponse.ok, true);
    assert.equal(fastResponse.ok, true);
    assert.ok(
      fastResponse.result.scheduler_passes > 0,
      "the deadline scheduler must advance without waiting for client traffic",
    );
  } finally {
    await fixture.close();
  }
});

test("UDS admission is capped and oversized input cannot kill the server", async () => {
  const fixture = await startFixtureTransportServer();
  const holding = [];
  try {
    for (let index = 0; index < 64; index += 1) {
      holding.push(await openHoldingConnection(fixture.socketPath));
    }
    await new Promise((resolve) => setTimeout(resolve, 75));
    const overCapacity = await openHoldingConnection(fixture.socketPath);
    await waitForSocketClose(overCapacity);

    for (const socket of holding.splice(0)) socket.destroy();
    await new Promise((resolve) => setTimeout(resolve, 75));

    const oversized = await udsRawLine(
      fixture.socketPath,
      `${"x".repeat(1_048_577)}\n`,
    );
    assert.equal(oversized.ok, false);
    assert.equal(oversized.error.code, "operational_message_too_large");
    assert.equal(oversized.error.message, "request failed");

    const recovered = await udsRequest(fixture.socketPath, "get_state");
    assert.equal(recovered.ok, true);
    assert.equal(recovered.result.fixture, "ok");
  } finally {
    for (const socket of holding) socket.destroy();
    await fixture.close();
  }
});

test("a lease owner replaces a stale same-uid socket and resumes service", async () => {
  const first = await startFixtureTransportServer();
  const firstExit = new Promise((resolve) => first.child.once("exit", resolve));
  first.child.kill("SIGKILL");
  await firstExit;
  const staleInfo = await lstat(first.socketPath);
  assert.equal(staleInfo.isSocket(), true);
  assert.equal(staleInfo.mode & 0o777, 0o600);

  const restarted = await startFixtureTransportServer({ directory: first.directory });
  try {
    const response = await udsRequest(restarted.socketPath, "get_state");
    assert.equal(response.ok, true);
    assert.equal(response.result.fixture, "ok");
  } finally {
    await restarted.close();
  }
});

test("unsafe regular-file and symlink socket entries fail closed and are preserved", async () => {
  const build = await buildCoordinator();
  const regularDirectory = await mkdtemp(path.join(tmpdir(), "blabee-t011-regular-"));
  const symlinkDirectory = await mkdtemp(path.join(tmpdir(), "blabee-t011-symlink-"));
  await Promise.all([chmod(regularDirectory, 0o700), chmod(symlinkDirectory, 0o700)]);
  try {
    const regularPath = path.join(regularDirectory, "blabee.sock");
    await writeFile(regularPath, "preserve-regular-entry", { mode: 0o600 });
    await chmod(regularPath, 0o600);
    const regularResult = await runBuiltBinary(
      build,
      ["transport-test-server", "--socket", regularPath],
      { timeoutMs: 5_000 },
    );
    assert.equal(regularResult.code, 1);
    assert.equal(await readFile(regularPath, "utf8"), "preserve-regular-entry");

    const targetPath = path.join(symlinkDirectory, "target");
    const symlinkPath = path.join(symlinkDirectory, "blabee.sock");
    await writeFile(targetPath, "preserve-symlink-target", { mode: 0o600 });
    await chmod(targetPath, 0o600);
    await symlink(targetPath, symlinkPath);
    const symlinkResult = await runBuiltBinary(
      build,
      ["transport-test-server", "--socket", symlinkPath],
      { timeoutMs: 5_000 },
    );
    assert.equal(symlinkResult.code, 1);
    assert.equal((await lstat(symlinkPath)).isSymbolicLink(), true);
    assert.equal(await readFile(targetPath, "utf8"), "preserve-symlink-target");
  } finally {
    await Promise.all([
      rm(regularDirectory, { force: true, recursive: true }),
      rm(symlinkDirectory, { force: true, recursive: true }),
    ]);
  }
});

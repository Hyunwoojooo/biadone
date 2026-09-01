import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmod,
  cp,
  lstat,
  mkdir,
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
  "next_actions",
  "reported_side_effects",
];
const operationalProposal = Object.fromEntries(
  operationalProposalKeys.map((key) => [key, proposal[key]]),
);
const legacyOperationalProposalKeys = [
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
const legacyOperationalProposal = Object.fromEntries(
  legacyOperationalProposalKeys.map((key) => {
    if (key === "recommended_next") return [key, proposal.next_actions[0]];
    if (key === "alternative_next") return [key, proposal.next_actions[1]];
    if (key === "pause_capsule") return [key, { resume_first: "Re-open the cached result" }];
    return [key, proposal[key]];
  }),
);
const hookSessionID = "01a01ece-22b8-7833-9ebf-8ef8d1addc58";
const fixtureRuntimeIdentity = `sha256:${"1".repeat(64)}`;
const runtimeRequestTypePrefix = "blabee.runtime-identity.v1/";
const hookTurnIDs = {
  allow: "01a02e18-df50-73b2-8ba3-000000000001",
  deny: "01a02e18-df50-73b2-8ba3-000000000002",
  defer: "01a02e18-df50-73b2-8ba3-000000000003",
  stdoutFailure: "01a02e18-df50-73b2-8ba3-000000000004",
  ackFailure: "01a02e18-df50-73b2-8ba3-000000000005",
};

function hookPayload(hook_event_name, eventFields = {}) {
  return {
    session_id: hookSessionID,
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

async function startFakeCoordinator(
  handler,
  { responseRuntimeIdentity = (request) => request.runtime_identity } = {},
) {
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
        assert.equal(request.type.startsWith(runtimeRequestTypePrefix), true);
        const result = await handler({
          ...request,
          type: request.type.slice(runtimeRequestTypePrefix.length),
        });
        socket.end(`${JSON.stringify({
          request_id: request.request_id,
          runtime_identity: responseRuntimeIdentity(request),
          ok: true,
          result,
        })}\n`);
      } catch (error) {
        if (typeof error?.coordinatorCode === "string") {
          socket.end(`${JSON.stringify({
            request_id: JSON.parse(buffer.subarray(0, newline).toString("utf8")).request_id,
            runtime_identity: responseRuntimeIdentity(JSON.parse(
              buffer.subarray(0, newline).toString("utf8"),
            )),
            ok: false,
            error: { code: error.coordinatorCode, message: "request failed" },
          })}\n`);
        } else {
          socket.destroy();
        }
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

async function startLegacyFakeCoordinator(handler) {
  const directory = await mkdtemp(path.join(tmpdir(), "blabee-t011-legacy-uds-"));
  await chmod(directory, 0o700);
  const socketPath = path.join(directory, "blabee.sock");
  const legacyTypes = new Set([
    "hook_event",
    "emit_decision",
    "get_state",
    "select_action",
    "doctor_status",
  ]);
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on("data", async (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const newline = buffer.indexOf(0x0a);
      if (newline < 0) return;
      socket.pause();
      const request = JSON.parse(buffer.subarray(0, newline).toString("utf8"));
      if (!legacyTypes.has(request.type)) {
        socket.end(`${JSON.stringify({
          request_id: request.request_id,
          ok: false,
          error: { code: "operational_type_unsupported", message: "unsupported" },
        })}\n`);
        return;
      }
      await handler(request);
      socket.end(`${JSON.stringify({
        request_id: request.request_id,
        ok: true,
        result: { accepted: true },
      })}\n`);
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
    env: {
      ...build.environment,
      BLABEE_RUNTIME_IDENTITY: fixtureRuntimeIdentity,
      BLABEE_MANAGED_APPROVALS: "",
      ...environment,
    },
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
    {
      env: {
        ...build.environment,
        BLABEE_RUNTIME_IDENTITY: fixtureRuntimeIdentity,
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

async function startOperationalApprovalServer() {
  const build = await buildCoordinator();
  const fixtureRoot = await mkdtemp("/tmp/blabee-t011-approval-uds-");
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
        BLABEE_RUNTIME_IDENTITY: fixtureRuntimeIdentity,
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
      reject(new Error("approval operational server did not become ready"));
    }, 20_000);
    const onExit = (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(
        `approval operational server exited before ready (code=${code}, signal=${signal}, stderr=${Buffer.concat(stderr)})`,
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
    enabledProjectPath,
    fixtureRoot,
    socketPath,
    async close() {
      if (child.exitCode === null && child.signalCode === null) {
        const termination = await new Promise((resolve) => {
          child.once("exit", (code, signal) => {
            resolve({ code, signal });
          });
          child.kill("SIGKILL");
        });
        assert.deepEqual(
          termination,
          { code: null, signal: "SIGKILL" },
          Buffer.concat(stderr).toString("utf8"),
        );
      }
      assert.equal(Buffer.concat(stderr).toString("utf8"), "");
      await rm(fixtureRoot, { force: true, recursive: true });
    },
  };
}

async function waitForApprovalSnapshot(socketPath, key, count) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await udsRequest(socketPath, "get_state");
    assert.equal(response.ok, true);
    if (response.result[key]?.length === count) return response.result[key];
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`${key} did not reach count ${count}`);
}

function udsRequest(
  socketPath,
  type,
  payload = {},
  runtimeIdentity = fixtureRuntimeIdentity,
) {
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
      socket.write(`${JSON.stringify({
        request_id,
        runtime_identity: runtimeIdentity,
        type: `${runtimeRequestTypePrefix}${type}`,
        payload,
      })}\n`);
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
        runtime_identity: fixtureRuntimeIdentity,
        type: `${runtimeRequestTypePrefix}${type}`,
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

function sendRequestThenDisconnect(socketPath, type, payload, holdMs = 250) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };
    socket.once("error", fail);
    socket.once("connect", () => {
      socket.write(`${JSON.stringify({
        request_id: `request_disconnect_${Math.random().toString(16).slice(2)}`,
        runtime_identity: fixtureRuntimeIdentity,
        type: `${runtimeRequestTypePrefix}${type}`,
        payload,
      })}\n`, (error) => {
        if (error) {
          fail(error);
          return;
        }
        setTimeout(() => {
          if (settled) return;
          settled = true;
          socket.off("error", fail);
          socket.destroy();
          resolve();
        }, holdMs);
      });
    });
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
    assert.match(request.runtime_identity, /^sha256:[0-9a-f]{64}$/);
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

test("Hook events map exact public outputs and reject legacy allow", async () => {
  const assistantMessage = "sensitive assistant message must not reach adapter output";
  const payloads = {
    UserPromptSubmit: hookPayload("UserPromptSubmit", {
      prompt: "Continue the fictional implementation.",
    }),
    PermissionLegacyAllow: hookPayload("PermissionRequest", {
      turn_id: hookTurnIDs.allow,
      tool_name: "Bash",
      tool_input: { command: "fictional-allow-command" },
    }),
    PermissionDeny: hookPayload("PermissionRequest", {
      turn_id: hookTurnIDs.deny,
      tool_name: "Bash",
      tool_input: { command: "fictional-deny-command" },
    }),
    PermissionDefer: hookPayload("PermissionRequest", {
      turn_id: hookTurnIDs.defer,
      tool_name: "Bash",
      tool_input: { command: "fictional-defer-command" },
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
    if (request.type === "ack_permission_request_delivery") {
      assert.deepEqual(Object.keys(request.payload).sort(), [
        "delivery_token", "kind", "request_id", "schema_version", "session_id", "turn_id",
      ]);
      assert.equal(request.payload.schema_version, "1.0");
      assert.equal(request.payload.kind, "blabee_permission_request_delivery_ack");
      return {};
    }
    if (request.type === "permission_request") {
      const command = request.payload.tool_input.command;
      const suffix = command.includes("allow")
        ? "allow"
        : command.includes("deny") ? "deny" : "defer";
      return {
        decision: suffix === "defer" ? "defer_to_codex" : suffix,
        delivery_token: `permission_delivery_${suffix}_token_1234`,
        request_id: `permission_request_${suffix}`,
        session_id: request.payload.session_id,
        turn_id: request.payload.turn_id,
      };
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

    const permissionLegacyAllow = await runBinary(
      ["hook", "PermissionRequest", "--socket", fake.socketPath],
      { input: JSON.stringify(payloads.PermissionLegacyAllow) },
    );
    assert.deepEqual(
      {
        code: permissionLegacyAllow.code,
        stderr: permissionLegacyAllow.stderr,
        stdout: permissionLegacyAllow.stdout,
      },
      { code: 0, stderr: "", stdout: "" },
    );

    const permissionDeny = await runBinary(
      ["hook", "PermissionRequest", "--socket", fake.socketPath],
      { input: JSON.stringify(payloads.PermissionDeny) },
    );
    assert.deepEqual(JSON.parse(permissionDeny.stdout), {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: {
          behavior: "deny",
          message: "Blabee에서 사용자가 거절했습니다.",
        },
      },
    });

    const permissionDefer = await runBinary(
      ["hook", "PermissionRequest", "--socket", fake.socketPath],
      { input: JSON.stringify(payloads.PermissionDefer) },
    );
    assert.deepEqual(
      {
        code: permissionDefer.code,
        stderr: permissionDefer.stderr,
        stdout: permissionDefer.stdout,
      },
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
      { type: "permission_request", payload: payloads.PermissionLegacyAllow },
      { type: "permission_request", payload: payloads.PermissionDeny },
      {
        type: "ack_permission_request_delivery",
        payload: {
          schema_version: "1.0",
          kind: "blabee_permission_request_delivery_ack",
          request_id: "permission_request_deny",
          session_id: hookSessionID,
          turn_id: hookTurnIDs.deny,
          delivery_token: "permission_delivery_deny_token_1234",
        },
      },
      { type: "permission_request", payload: payloads.PermissionDefer },
      {
        type: "ack_permission_request_delivery",
        payload: {
          schema_version: "1.0",
          kind: "blabee_permission_request_delivery_ack",
          request_id: "permission_request_defer",
          session_id: hookSessionID,
          turn_id: hookTurnIDs.defer,
          delivery_token: "permission_delivery_defer_token_1234",
        },
      },
      { type: "stop", payload: payloads.StopBlock },
      { type: "stop", payload: payloads.StopNoDecision },
    ]);
    for (const result of [
      userPrompt, permissionLegacyAllow, permissionDeny, permissionDefer,
      stopBlock, stopNoDecision,
    ]) {
      assert.equal(result.stdout.includes(assistantMessage), false);
      assert.equal(result.stderr.includes(assistantMessage), false);
    }
  } finally {
    await fake.close();
  }
});

test("Hook stdout write failure sends no permission delivery acknowledgement", async () => {
  let acknowledgementCalls = 0;
  const fake = await startFakeCoordinator((request) => {
    if (request.type === "permission_request") {
      return {
        decision: "deny",
        delivery_token: "permission_delivery_stdout_failure_1234",
        request_id: "permission_request_stdout_failure",
        session_id: hookSessionID,
        turn_id: hookTurnIDs.stdoutFailure,
      };
    }
    if (request.type === "ack_permission_request_delivery") {
      acknowledgementCalls += 1;
      return {};
    }
    throw new Error(`unexpected request ${request.type}`);
  });
  try {
    const build = await buildProductCoordinator();
    const child = spawn(
      build.binaryPath,
      ["hook", "PermissionRequest", "--socket", fake.socketPath],
      {
        env: { ...build.environment, BLABEE_MANAGED_APPROVALS: "" },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const stderr = [];
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.stdout.destroy();
    await new Promise((resolve) => setImmediate(resolve));
    child.stdin.end(JSON.stringify(hookPayload("PermissionRequest", {
      turn_id: hookTurnIDs.stdoutFailure,
      tool_name: "Bash",
      tool_input: { command: "fictional-stdout-failure-command" },
    })));
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("Hook with closed stdout did not exit"));
      }, 15_000);
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    assert.equal(acknowledgementCalls, 0);
    assert.equal(Buffer.concat(stderr).toString("utf8"), "");
  } finally {
    await fake.close();
  }
});

test("Hook acknowledgement failure never retries or rewrites official stdout", async () => {
  let permissionCalls = 0;
  let acknowledgementCalls = 0;
  const fake = await startFakeCoordinator((request) => {
    if (request.type === "permission_request") {
      permissionCalls += 1;
      return {
        decision: "deny",
        delivery_token: "permission_delivery_ack_failure_1234",
        request_id: "permission_request_ack_failure",
        session_id: hookSessionID,
        turn_id: hookTurnIDs.ackFailure,
      };
    }
    if (request.type === "ack_permission_request_delivery") {
      acknowledgementCalls += 1;
      const error = new Error("fixture acknowledgement failure");
      error.coordinatorCode = "permission_request_delivery_ack_invalid";
      throw error;
    }
    throw new Error(`unexpected request ${request.type}`);
  });
  try {
    const result = await runBinary(
      ["hook", "PermissionRequest", "--socket", fake.socketPath],
      {
        input: JSON.stringify(hookPayload("PermissionRequest", {
          turn_id: hookTurnIDs.ackFailure,
          tool_name: "Bash",
          tool_input: { command: "fictional-ack-failure-command" },
        })),
      },
    );
    assert.deepEqual(
      { code: result.code, signal: result.signal, stderr: result.stderr },
      { code: 0, signal: null, stderr: "" },
    );
    assert.deepEqual(JSON.parse(result.stdout), {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: {
          behavior: "deny",
          message: "Blabee에서 사용자가 거절했습니다.",
        },
      },
    });
    assert.equal(permissionCalls, 1);
    assert.equal(acknowledgementCalls, 1);
  } finally {
    await fake.close();
  }
});

test("Hook native defer closes stdout before acknowledging delivery", async () => {
  let acknowledgementCalls = 0;
  let stdoutEnded = false;
  let resolveStdoutEnd;
  const stdoutEnd = new Promise((resolve) => {
    resolveStdoutEnd = resolve;
  });
  const fake = await startFakeCoordinator(async (request) => {
    if (request.type === "permission_request") {
      return {
        decision: "defer_to_codex",
        delivery_token: "permission_delivery_defer_eof_1234",
        request_id: "permission_request_defer_eof",
        session_id: hookSessionID,
        turn_id: hookTurnIDs.defer,
      };
    }
    if (request.type === "ack_permission_request_delivery") {
      acknowledgementCalls += 1;
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Hook acknowledged before stdout EOF")),
          2_000,
        );
        stdoutEnd.then(() => {
          clearTimeout(timeout);
          resolve();
        });
      });
      assert.equal(stdoutEnded, true);
      return {};
    }
    throw new Error(`unexpected request ${request.type}`);
  });
  try {
    const build = await buildProductCoordinator();
    const child = spawn(
      build.binaryPath,
      ["hook", "PermissionRequest", "--socket", fake.socketPath],
      {
        env: { ...build.environment, BLABEE_MANAGED_APPROVALS: "" },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stdout.once("end", () => {
      stdoutEnded = true;
      resolveStdoutEnd();
    });
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.stdin.end(JSON.stringify(hookPayload("PermissionRequest", {
      turn_id: hookTurnIDs.defer,
      tool_name: "Bash",
      tool_input: { command: "fictional-defer-eof-command" },
    })));
    const exit = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("Hook native defer did not exit"));
      }, 15_000);
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", (code, signal) => {
        clearTimeout(timeout);
        resolve({ code, signal });
      });
    });
    assert.deepEqual(exit, { code: 0, signal: null });
    assert.equal(Buffer.concat(stdout).toString("utf8"), "");
    assert.equal(Buffer.concat(stderr).toString("utf8"), "");
    assert.equal(acknowledgementCalls, 1);
    assert.equal(stdoutEnded, true);
  } finally {
    await fake.close();
  }
});

test("Hook rejects malformed internal delivery identifiers without acknowledgement", async () => {
  let acknowledgementCalls = 0;
  const fake = await startFakeCoordinator((request) => {
    if (request.type === "permission_request") {
      return {
        decision: "deny",
        delivery_token: "permission_delivery_bad_identifier_1234",
        request_id: "permission_request_bad_identifier",
        session_id: "e\u0301-session-not-nfc",
        turn_id: hookTurnIDs.allow,
      };
    }
    if (request.type === "ack_permission_request_delivery") {
      acknowledgementCalls += 1;
      return {};
    }
    throw new Error(`unexpected request ${request.type}`);
  });
  try {
    const result = await runBinary(
      ["hook", "PermissionRequest", "--socket", fake.socketPath],
      {
        input: JSON.stringify(hookPayload("PermissionRequest", {
          turn_id: hookTurnIDs.allow,
          tool_name: "Bash",
          tool_input: { command: "fictional-bad-identifier-command" },
        })),
      },
    );
    assert.deepEqual(result, { code: 0, signal: null, stderr: "", stdout: "" });
    assert.equal(acknowledgementCalls, 0);
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

test("rejected Hook approval input fails open to native Codex", async () => {
  const fake = await startFakeCoordinator(() => {
    const error = new Error("fixture unsafe approval input");
    error.coordinatorCode = "permission_request_tool_input_invalid";
    throw error;
  });
  try {
    const result = await runBinary(
      ["hook", "PermissionRequest", "--socket", fake.socketPath],
      {
        input: JSON.stringify(hookPayload("PermissionRequest", {
          tool_name: "Bash",
          tool_input: {
            command: "fictional-safe-visible-command",
            hidden_authority: "must-not-be-approved",
          },
        })),
      },
    );
    assert.deepEqual(
      { code: result.code, signal: result.signal, stderr: result.stderr, stdout: result.stdout },
      { code: 0, signal: null, stderr: "", stdout: "" },
    );
  } finally {
    await fake.close();
  }
});

test("managed App Server ownership makes PermissionRequest Hook defer without IPC", async () => {
  let forwardedCalls = 0;
  const fake = await startFakeCoordinator(() => {
    forwardedCalls += 1;
    return { decision: "deny" };
  });
  try {
    const result = await runBinary(
      ["hook", "PermissionRequest", "--socket", fake.socketPath],
      {
        environment: { BLABEE_MANAGED_APPROVALS: "1" },
        input: JSON.stringify(hookPayload("PermissionRequest", {
          tool_name: "Bash",
          tool_input: { command: "fictional-managed-command" },
        })),
      },
    );
    assert.deepEqual(
      { code: result.code, stderr: result.stderr, stdout: result.stdout },
      { code: 0, stderr: "", stdout: "" },
    );
    assert.equal(forwardedCalls, 0);
  } finally {
    await fake.close();
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
  const build = await buildProductCoordinator();
  const fake = await startFakeCoordinator(
    () => new Promise(() => {}),
  );
  try {
    const startedAt = Date.now();
    const result = await runBuiltBinary(
      build,
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

test("MCP requires the ranked proposal schema and never echoes correlation tokens", async () => {
  let forwardedCalls = 0;
  const fake = await startFakeCoordinator((request) => {
    assert.equal(request.type, "emit_decision");
    assert.deepEqual(request.payload.proposal, operationalProposal);
    forwardedCalls += 1;
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
  const legacyArguments = {
    project_id: proposal.project_id,
    session_id: proposal.session_id,
    source_turn_id: proposal.source_turn_id,
    source_prompt_id: proposal.source_prompt_id,
    episode_id: proposal.episode_id,
    correlation_token: proposal.correlation_token,
    proposal: legacyOperationalProposal,
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
      params: { name: "emit_decision", arguments: legacyArguments },
    },
    {
      jsonrpc: "2.0",
      id: 5,
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
    assert.equal(responses.length, 5);
    assert.equal(responses[0].result.protocolVersion, "2025-06-18");
    const tool = responses[1].result.tools[0];
    assert.equal(tool.name, "emit_decision");
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.inputSchema.properties.proposal.additionalProperties, false);
    for (const required of [
      "proposal_id",
      "next_actions",
      "reported_side_effects",
    ]) {
      assert.equal(tool.inputSchema.properties.proposal.required.includes(required), true);
    }
    assert.deepEqual(
      tool.inputSchema.properties.proposal.properties.outcome.required,
      ["status", "summary"],
    );
    assert.deepEqual(
      tool.inputSchema.properties.proposal.properties.next_actions.items.required,
      ["title", "objective", "constraints", "done_when"],
    );
    assert.equal(tool.inputSchema.properties.proposal.properties.next_actions.minItems, 2);
    assert.equal(tool.inputSchema.properties.proposal.properties.next_actions.maxItems, 4);
    for (const legacyField of ["recommended_next", "alternative_next", "pause_capsule"]) {
      assert.equal(
        Object.hasOwn(tool.inputSchema.properties.proposal.properties, legacyField),
        false,
      );
    }
    assert.deepEqual(responses[2].result.structuredContent, {
      accepted: true,
      status: "waiting_for_selection",
    });
    assert.equal(responses[3].result.isError, true);
    assert.deepEqual(responses[3].result.structuredContent, {
      accepted: false,
      error_code: "coordinator_unavailable_or_rejected",
      retryable: false,
    });
    assert.equal(responses[4].result.isError, true);
    assert.deepEqual(responses[4].result.structuredContent, {
      accepted: false,
      error_code: "coordinator_unavailable_or_rejected",
      retryable: false,
    });
    assert.equal(forwardedCalls, 1, "legacy and invalid exact-key wrappers must not reach UDS");
    assert.equal(result.stdout.includes(proposal.correlation_token), false);
  } finally {
    await fake.close();
  }
});

test("MCP exposes only allowlisted decision failure metadata", async () => {
  let forwardedCalls = 0;
  const fake = await startFakeCoordinator(() => {
    forwardedCalls += 1;
    const error = new Error("fixture coordinator rejection");
    error.coordinatorCode = forwardedCalls === 1
      ? "proposal_source_prompt_mismatch"
      : "database_integrity_failed";
    throw error;
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
  const messages = ["binding", "internal"].map((id) => ({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: "emit_decision", arguments: arguments_ },
  }));
  try {
    const result = await runBinary(
      ["mcp", "--socket", fake.socketPath],
      { input: `${messages.map((message) => JSON.stringify(message)).join("\n")}\n` },
    );
    assert.deepEqual({ code: result.code, signal: result.signal }, { code: 0, signal: null });
    assert.equal(result.stderr, "");
    const responses = result.stdout.trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(responses[0].result.structuredContent, {
      accepted: false,
      error_code: "proposal_source_prompt_mismatch",
      retryable: true,
    });
    assert.deepEqual(responses[1].result.structuredContent, {
      accepted: false,
      error_code: "coordinator_unavailable_or_rejected",
      retryable: false,
    });
    for (const response of responses) {
      assert.equal(response.result.isError, true);
      assert.equal(
        response.result.content[0].text,
        "Blabee coordinator unavailable or rejected the proposal.",
      );
    }
    assert.equal(forwardedCalls, 2);
    assert.equal(result.stdout.includes(proposal.correlation_token), false);
    assert.equal(result.stdout.includes(proposal.task_goal), false);
    assert.equal(result.stdout.includes("database_integrity_failed"), false);
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
    assert.deepEqual(response.result.structuredContent, {
      accepted: false,
      error_code: "coordinator_unavailable_or_rejected",
      retryable: false,
    });
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

    const legacy = await udsRawLine(
      fixture.socketPath,
      `${JSON.stringify({
        request_id: "request_fixture_legacy",
        type: "get_state",
        payload: {},
      })}\n`,
    );
    assert.equal(legacy.runtime_identity, fixtureRuntimeIdentity);
    assert.equal(legacy.ok, false);
    assert.equal(legacy.error.code, "operational_runtime_identity_mismatch");

    const mismatched = await udsRequest(
      fixture.socketPath,
      "get_state",
      {},
      `sha256:${"2".repeat(64)}`,
    );
    assert.equal(mismatched.runtime_identity, fixtureRuntimeIdentity);
    assert.equal(mismatched.ok, false);
    assert.equal(mismatched.error.code, "operational_runtime_identity_mismatch");

    await udsRequestExpectingClosedWithoutResponse(fixture.socketPath, "get_state", {
      correlation_token: "request_id",
    });
    const stillAlive = await udsRequest(fixture.socketPath, "get_state");
    assert.equal(stillAlive.runtime_identity, fixtureRuntimeIdentity);
    assert.equal(stillAlive.ok, true);
    assert.equal(stillAlive.result.fixture, "ok");

    const focusAccepted = await udsRequest(fixture.socketPath, "focus_interaction", {});
    assert.equal(focusAccepted.ok, true);
    assert.equal(focusAccepted.result.handled_type, "focus_interaction");

    const permissionResolutionAccepted = await udsRequest(
      fixture.socketPath,
      "resolve_permission_request",
      {},
    );
    assert.equal(permissionResolutionAccepted.ok, true);
    assert.equal(
      permissionResolutionAccepted.result.handled_type,
      "resolve_permission_request",
    );

    const deliveryAckAccepted = await udsRequest(
      fixture.socketPath,
      "ack_managed_command_approval_delivery",
      {},
    );
    assert.equal(deliveryAckAccepted.ok, true);
    assert.equal(
      deliveryAckAccepted.result.handled_type,
      "ack_managed_command_approval_delivery",
    );

    const permissionDeliveryAckAccepted = await udsRequest(
      fixture.socketPath,
      "ack_permission_request_delivery",
      {},
    );
    assert.equal(permissionDeliveryAckAccepted.ok, true);
    assert.equal(
      permissionDeliveryAckAccepted.result.handled_type,
      "ack_permission_request_delivery",
    );

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

test("a new client cannot dispatch a state-changing request through a legacy server", async () => {
  let legacyDispatches = 0;
  const legacy = await startLegacyFakeCoordinator(() => {
    legacyDispatches += 1;
  });
  try {
    const result = await runBinary(
      ["hook", "SessionStart", "--socket", legacy.socketPath],
      {
        input: JSON.stringify(hookPayload("SessionStart", { source: "startup" })),
      },
    );
    assert.deepEqual(result, { code: 0, signal: null, stderr: "", stdout: "" });
    assert.equal(
      legacyDispatches,
      0,
      "the prefixed wire type must be rejected before a legacy handler dispatches",
    );
  } finally {
    await legacy.close();
  }
});

test("Hook rejects missing or forged runtime identity responses without exposing context", async () => {
  for (const responseRuntimeIdentity of [
    () => undefined,
    () => `sha256:${"9".repeat(64)}`,
  ]) {
    let dispatches = 0;
    const fake = await startFakeCoordinator(
      () => {
        dispatches += 1;
        return { enabled: true, additionalContext: "must-not-reach-codex" };
      },
      { responseRuntimeIdentity },
    );
    try {
      const result = await runBinary(
        ["hook", "UserPromptSubmit", "--socket", fake.socketPath],
        { input: JSON.stringify(hookPayload("UserPromptSubmit", { prompt: "probe" })) },
      );
      assert.deepEqual(result, { code: 0, signal: null, stderr: "", stdout: "" });
      assert.equal(dispatches, 1);
    } finally {
      await fake.close();
    }
  }
});

test("managed approval peer disconnect cancels waiters and releases UDS admission", async () => {
  const fixture = await startFixtureTransportServer();
  try {
    await Promise.all(Array.from({ length: 64 }, (_, index) =>
      sendRequestThenDisconnect(
        fixture.socketPath,
        "managed_command_approval",
        { fixture_delay_ms: 2_000, fixture_index: index },
      )));

    // Peer liveness uses a bounded 100 ms poll. Leave enough margin for all
    // detached handlers to observe EOF and release their admission leases.
    await new Promise((resolve) => setTimeout(resolve, 350));
    const response = await udsRequest(fixture.socketPath, "get_state");
    assert.equal(response.ok, true);
    assert.equal(response.result.fixture, "ok");
  } finally {
    await fixture.close();
  }
});

test("Hook approval peer disconnect cancels waiters and releases UDS admission", async () => {
  const fixture = await startFixtureTransportServer();
  try {
    await Promise.all(Array.from({ length: 64 }, (_, index) =>
      sendRequestThenDisconnect(
        fixture.socketPath,
        "permission_request",
        { fixture_delay_ms: 2_000, fixture_index: index },
      )));

    // Hook approvals use the same bounded peer-liveness race as managed
    // approvals, so disconnected Hook processes must release all leases.
    await new Promise((resolve) => setTimeout(resolve, 350));
    const response = await udsRequest(fixture.socketPath, "get_state");
    assert.equal(response.ok, true);
    assert.equal(response.result.fixture, "ok");
  } finally {
    await fixture.close();
  }
});

test("real Hook deny resolves Pet only after official stdout and delivery ack", async () => {
  const server = await startOperationalApprovalServer();
  try {
    const productBuild = await buildProductCoordinator();
    const turnID = "turn_permission_delivery_live";
    const userPromptPayload = hookPayload("UserPromptSubmit", {
      cwd: server.enabledProjectPath,
      turn_id: turnID,
      prompt: "Bind the live Hook delivery test",
    });
    const userPrompt = await runBuiltBinary(
      productBuild,
      ["hook", "UserPromptSubmit", "--socket", server.socketPath],
      { input: JSON.stringify(userPromptPayload) },
    );
    assert.equal(userPrompt.code, 0);
    assert.notEqual(userPrompt.stdout, "");

    const petHeartbeat = await udsRequest(server.socketPath, "get_state", {
      schema_version: "1.0",
      kind: "blabee_pet_snapshot_request",
      consumer_heartbeat: true,
    });
    assert.equal(petHeartbeat.ok, true);

    const permissionCompletion = runBuiltBinary(
      productBuild,
      ["hook", "PermissionRequest", "--socket", server.socketPath],
      {
        input: JSON.stringify(hookPayload("PermissionRequest", {
          cwd: server.enabledProjectPath,
          turn_id: turnID,
          tool_name: "Bash",
          tool_input: { command: "printf live-hook-delivery" },
        })),
      },
    );
    const [request] = await waitForApprovalSnapshot(
      server.socketPath,
      "permission_requests",
      1,
    );
    assert.equal(request.delivery_pending, false);
    const resolution = udsRequest(
      server.socketPath,
      "resolve_permission_request",
      {
        schema_version: "1.0",
        kind: "blabee_permission_resolution_request",
        request_id: request.request_id,
        response_id: "permission_response_live_stdout",
        project_id: request.project_id,
        session_id: request.session_id,
        turn_id: request.turn_id,
        decision: "deny",
      },
    );
    const [permission, resolved] = await Promise.all([
      permissionCompletion,
      resolution,
    ]);
    assert.deepEqual(
      { code: permission.code, signal: permission.signal, stderr: permission.stderr },
      { code: 0, signal: null, stderr: "" },
    );
    assert.deepEqual(JSON.parse(permission.stdout), {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: {
          behavior: "deny",
          message: "Blabee에서 사용자가 거절했습니다.",
        },
      },
    });
    assert.equal(resolved.ok, true);
    assert.deepEqual(resolved.result, {
      decision: "deny",
      request_id: request.request_id,
      resolved: true,
      response_id: "permission_response_live_stdout",
    });
    await waitForApprovalSnapshot(server.socketPath, "permission_requests", 0);
  } finally {
    await server.close();
  }
});

test("managed Pet disconnect after selection keeps FIFO barrier until delivery ack", async () => {
  const server = await startOperationalApprovalServer();
  const managedPayload = (suffix) => ({
    schema_version: "1.0",
    kind: "blabee_managed_command_approval_request",
    broker_epoch: `broker_epoch_${suffix}`,
    connection_id: `connection_${suffix}`,
    jsonrpc_request_id: { type: "string", value: `rpc-${suffix}` },
    thread_id: `thread_${suffix}`,
    turn_id: `turn_${suffix}`,
    item_id: `item_${suffix}`,
    approval_id: `approval_${suffix}`,
    environment_id: "local",
    cwd: `/tmp/blabee-managed-${suffix}`,
    command_preview: `printf ${suffix}`,
    allow_once_available: true,
    decline_available: true,
  });
  const resolution = (request, responseID) => {
    const result = { ...request };
    delete result.arrival_sequence;
    delete result.delivery_pending;
    result.schema_version = "1.0";
    result.kind = "blabee_managed_command_approval_resolution_request";
    result.response_id = responseID;
    result.decision = "accept_once";
    return result;
  };
  const acknowledgement = (request, deliveryToken) => ({
    schema_version: "1.0",
    kind: "blabee_managed_command_approval_delivery_ack",
    broker_epoch: request.broker_epoch,
    connection_id: request.connection_id,
    jsonrpc_request_id: request.jsonrpc_request_id,
    thread_id: request.thread_id,
    turn_id: request.turn_id,
    item_id: request.item_id,
    approval_id: request.approval_id,
    environment_id: request.environment_id,
    delivery_token: deliveryToken,
  });
  try {
    const initialPetHeartbeat = await udsRequest(server.socketPath, "get_state", {
      schema_version: "1.0",
      kind: "blabee_pet_snapshot_request",
      consumer_heartbeat: true,
    });
    assert.equal(initialPetHeartbeat.ok, true);

    const firstBroker = udsRequest(
      server.socketPath,
      "managed_command_approval",
      managedPayload("disconnect_first"),
    );
    await waitForApprovalSnapshot(server.socketPath, "managed_command_approvals", 1);
    const secondBroker = udsRequest(
      server.socketPath,
      "managed_command_approval",
      managedPayload("disconnect_second"),
    );
    const [first, second] = await waitForApprovalSnapshot(
      server.socketPath,
      "managed_command_approvals",
      2,
    );

    const disconnectedPet = sendRequestThenDisconnect(
      server.socketPath,
      "resolve_managed_command_approval",
      resolution(first, "managed_response_disconnected_pet"),
      100,
    );
    const firstOutcome = await firstBroker;
    assert.equal(firstOutcome.ok, true);
    assert.equal(firstOutcome.result.decision, "accept_once");
    assert.match(firstOutcome.result.delivery_token, /^[A-Za-z0-9_-]{16,512}$/);
    await disconnectedPet;

    const continuedPetHeartbeat = await udsRequest(server.socketPath, "get_state", {
      schema_version: "1.0",
      kind: "blabee_pet_snapshot_request",
      consumer_heartbeat: true,
    });
    assert.equal(continuedPetHeartbeat.ok, true);

    const [selectedFirst] = await waitForApprovalSnapshot(
      server.socketPath,
      "managed_command_approvals",
      2,
    );
    assert.equal(selectedFirst.delivery_pending, true);
    const followerBeforeAck = await udsRequest(
      server.socketPath,
      "resolve_managed_command_approval",
      resolution(second, "managed_response_follower_too_early"),
    );
    assert.equal(followerBeforeAck.ok, false);
    assert.equal(followerBeforeAck.error.code, "managed_command_approval_not_head");

    const firstAck = await udsRequest(
      server.socketPath,
      "ack_managed_command_approval_delivery",
      acknowledgement(first, firstOutcome.result.delivery_token),
    );
    assert.equal(firstAck.ok, true);
    assert.deepEqual(firstAck.result, {});
    const [remaining] = await waitForApprovalSnapshot(
      server.socketPath,
      "managed_command_approvals",
      1,
    );
    assert.equal(remaining.managed_request_id, second.managed_request_id);

    const secondResolution = udsRequest(
      server.socketPath,
      "resolve_managed_command_approval",
      resolution(second, "managed_response_after_disconnected_pet_ack"),
    );
    const secondOutcome = await secondBroker;
    assert.equal(secondOutcome.ok, true);
    const secondAck = await udsRequest(
      server.socketPath,
      "ack_managed_command_approval_delivery",
      acknowledgement(second, secondOutcome.result.delivery_token),
    );
    assert.equal(secondAck.ok, true);
    const secondReceipt = await secondResolution;
    assert.equal(secondReceipt.ok, true);
    await waitForApprovalSnapshot(server.socketPath, "managed_command_approvals", 0);
  } finally {
    await server.close();
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

test("an idle scheduler skips time processing and discovers newly-created deadlines", async () => {
  const fixture = await startFixtureTransportServer();
  try {
    await udsRequest(fixture.socketPath, "get_state", { fixture_scheduler_idle: true });
    // Allow any time pass scheduled before the idle request to finish, then
    // capture the stable idle baseline.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const idleBaseline = await udsRequest(fixture.socketPath, "get_state");
    await new Promise((resolve) => setTimeout(resolve, 650));
    const idleAfter = await udsRequest(fixture.socketPath, "get_state");
    assert.equal(
      idleAfter.result.scheduler_passes,
      idleBaseline.result.scheduler_passes,
      "nil deadlines must not trigger processTime",
    );

    const armed = await udsRequest(fixture.socketPath, "get_state", {
      fixture_scheduler_deadline_ms: 25,
    });
    const discoveryDeadline = Date.now() + 1_000;
    let progressed = armed;
    while (
      progressed.result.scheduler_passes <= armed.result.scheduler_passes
      && Date.now() < discoveryDeadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      progressed = await udsRequest(fixture.socketPath, "get_state");
    }
    assert.ok(
      progressed.result.scheduler_passes > armed.result.scheduler_passes,
      "bounded idle checks must discover and process a newly-created deadline",
    );
  } finally {
    await fixture.close();
  }
});

test("a long-future deadline skips early processing and can be shortened", async () => {
  const fixture = await startFixtureTransportServer();
  try {
    await udsRequest(fixture.socketPath, "get_state", {
      fixture_scheduler_deadline_ms: 2_000,
    });
    // Allow a pass scheduled from the fixture's initial short deadline to
    // finish before capturing the long-future baseline.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const futureBaseline = await udsRequest(fixture.socketPath, "get_state");
    await new Promise((resolve) => setTimeout(resolve, 650));
    const futureAfter = await udsRequest(fixture.socketPath, "get_state");
    assert.equal(
      futureAfter.result.scheduler_passes,
      futureBaseline.result.scheduler_passes,
      "deadlines beyond the bounded window must not trigger processTime",
    );

    const shortened = await udsRequest(fixture.socketPath, "get_state", {
      fixture_scheduler_deadline_ms: 25,
    });
    const discoveryDeadline = Date.now() + 1_000;
    let progressed = shortened;
    while (
      progressed.result.scheduler_passes <= shortened.result.scheduler_passes
      && Date.now() < discoveryDeadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      progressed = await udsRequest(fixture.socketPath, "get_state");
    }
    assert.ok(
      progressed.result.scheduler_passes > shortened.result.scheduler_passes,
      "bounded checks must discover and process a shortened deadline",
    );
  } finally {
    await fixture.close();
  }
});

test("scheduler failures back off and a successful recovery resets the retry delay", async () => {
  const fixture = await startFixtureTransportServer();
  try {
    const armed = await udsRequest(fixture.socketPath, "get_state", {
      fixture_scheduler_deadline_ms: 0,
      fixture_scheduler_fail_always: true,
      fixture_scheduler_idle_after_success: true,
    });
    const threeFailuresDeadline = Date.now() + 3_000;
    let failed = armed;
    while (
      failed.result.scheduler_failures < armed.result.scheduler_failures + 3
      && Date.now() < threeFailuresDeadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      failed = await udsRequest(fixture.socketPath, "get_state");
    }
    assert.ok(
      failed.result.scheduler_failures >= armed.result.scheduler_failures + 3,
      "the failure fixture must reach the exponential-backoff path",
    );

    const boundedFailureCount = failed.result.scheduler_failures;
    await new Promise((resolve) => setTimeout(resolve, 700));
    const bounded = await udsRequest(fixture.socketPath, "get_state");
    assert.equal(
      bounded.result.scheduler_failures,
      boundedFailureCount,
      "an already-due persistent failure must not hot-loop",
    );

    const recoveryRequested = await udsRequest(fixture.socketPath, "get_state", {
      fixture_scheduler_fail_always: false,
      fixture_scheduler_failures_remaining: 0,
    });
    const recoveryDeadline = Date.now() + 2_500;
    let recovered = recoveryRequested;
    while (
      recovered.result.scheduler_passes <= recoveryRequested.result.scheduler_passes
      && Date.now() < recoveryDeadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      recovered = await udsRequest(fixture.socketPath, "get_state");
    }
    assert.ok(
      recovered.result.scheduler_passes > recoveryRequested.result.scheduler_passes,
      "the scheduler must recover when processTime succeeds",
    );

    const rearmed = await udsRequest(fixture.socketPath, "get_state", {
      fixture_scheduler_deadline_ms: 0,
      fixture_scheduler_failures_remaining: 1,
    });
    const resetDeadline = Date.now() + 1_200;
    let resetObserved = rearmed;
    while (
      (
        resetObserved.result.scheduler_failures <= rearmed.result.scheduler_failures
        || resetObserved.result.scheduler_passes <= rearmed.result.scheduler_passes
      )
      && Date.now() < resetDeadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      resetObserved = await udsRequest(fixture.socketPath, "get_state");
    }
    assert.ok(
      resetObserved.result.scheduler_failures > rearmed.result.scheduler_failures,
      "the rearmed fixture must inject one failure",
    );
    assert.ok(
      resetObserved.result.scheduler_passes > rearmed.result.scheduler_passes,
      "a success must reset the next failure to the initial retry delay",
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

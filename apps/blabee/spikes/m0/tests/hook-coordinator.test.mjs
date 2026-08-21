import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_WAIT_EXPIRY_MS,
  DEFAULT_WAIT_REMINDER_MS,
} from "../coordinator/constants.mjs";
import { FakeCoordinator } from "../coordinator/fake-coordinator.mjs";
import { requestJsonl } from "../coordinator/jsonl-client.mjs";
import { parseContinuationPrompt } from "../coordinator/protocol.mjs";
import { startJsonlServer } from "../coordinator/server.mjs";
import { redactDiagnostics } from "../integration/run-codex-contract.mjs";
import {
  parseSentinelOnce,
  SENTINEL_END,
  SENTINEL_START,
} from "../sentinel/parser.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const m0Root = path.resolve(here, "..");
const hookScript = path.join(m0Root, "plugins/blabee-m0/scripts/hook.mjs");
const mcpScript = path.join(m0Root, "plugins/blabee-m0/scripts/mcp-server.mjs");

test("live contract diagnostics redact boundary and continuation tokens", () => {
  const correlationToken = "correlation-secret-value";
  const continuationToken = "continuation-secret-value";
  const escapedContinuationToken = "escaped-continuation-secret";
  const diagnostics = redactDiagnostics({
    codexStdout:
      `correlation_token=${correlationToken}; ` +
      JSON.stringify({ proposal: { correlation_token: correlationToken } }),
    state: {
      correlation_token: correlationToken,
      continuation_token: continuationToken,
      nested: `continuation token echoed without a label: ${continuationToken}`,
    },
    orphanNamedValue: "correlation_token=orphan-secret",
    nestedJsonl: JSON.stringify({
      item: {
        arguments: JSON.stringify({ continuation_token: escapedContinuationToken }),
      },
    }),
    unlabeledNestedEcho: escapedContinuationToken,
    safe: "packet_123",
  });
  const serialized = JSON.stringify(diagnostics);

  assert.equal(serialized.includes(correlationToken), false);
  assert.equal(serialized.includes(continuationToken), false);
  assert.equal(serialized.includes("orphan-secret"), false);
  assert.equal(serialized.includes(escapedContinuationToken), false);
  assert.equal(diagnostics.state.correlation_token, "<redacted>");
  assert.equal(diagnostics.state.continuation_token, "<redacted>");
  assert.equal(diagnostics.safe, "packet_123");
});

function proposal({ alternative = true, suffix = "A" } = {}) {
  return {
    schema_version: "1.0",
    interaction_kind: "blabee_decision",
    task_goal: `M0 goal ${suffix}`,
    outcome: { status: "completed", summary: `M0 completed ${suffix}` },
    recommended_next: {
      title: `Recommended ${suffix}`,
      objective: `Run the recommended work ${suffix}`,
      constraints: ["keep IDs sealed"],
      done_when: ["contract test passes"],
    },
    alternative_next: alternative
      ? {
          title: `Alternative ${suffix}`,
          objective: `Run the alternative work ${suffix}`,
          constraints: ["do not reinterpret slot 2"],
          done_when: ["alternative contract passes"],
        }
      : null,
    pause_capsule: { resume_first: "resume contract" },
    reported_side_effects: [],
  };
}

async function runNode(script, args, { input = "", env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: m0Root,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

async function withServer(run, coordinator = new FakeCoordinator()) {
  const temp = await mkdtemp(path.join(os.tmpdir(), "blabee-m0-test-"));
  const socketPath = path.join(temp, "coordinator.sock");
  const running = await startJsonlServer({ socketPath, coordinator });
  try {
    return await run({ socketPath, coordinator });
  } finally {
    await running.close();
    await rm(temp, { recursive: true, force: true });
  }
}

async function rpc(socketPath, type, payload = {}, options = {}) {
  return requestJsonl({ socketPath, type, payload, ...options });
}

async function beginEpisode(socketPath, {
  cwd = "/tmp/blabee-project",
  projectId = "project-test",
  sessionId = "session-test",
  turnId = "turn-test",
  prompt = "Implement the scoped M0 task",
} = {}) {
  await rpc(socketPath, "enable_project", { cwd, project_id: projectId });
  await rpc(socketPath, "session_start", {
    hook_event_name: "SessionStart",
    session_id: sessionId,
    cwd,
    source: "startup",
  });
  const boundary = await rpc(socketPath, "user_prompt_submit", {
    hook_event_name: "UserPromptSubmit",
    session_id: sessionId,
    turn_id: turnId,
    cwd,
    prompt,
  });
  return { cwd, projectId, sessionId, turnId, boundary, ids: boundary.identifiers };
}

async function emitProposal(socketPath, episode, value = proposal()) {
  const boundProposal = {
    ...value,
    correlation_token: episode.ids.correlation_token,
  };
  return rpc(socketPath, "emit_decision", {
    project_id: episode.ids.project_id,
    session_id: episode.ids.session_id,
    source_turn_id: episode.ids.source_turn_id,
    source_prompt_id: episode.ids.source_prompt_id,
    episode_id: episode.ids.episode_id,
    correlation_token: episode.ids.correlation_token,
    proposal: boundProposal,
  });
}

async function waitForWaitingInteraction(socketPath) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = await rpc(socketPath, "get_state");
    const interaction = state.interactions.find((item) => item.state === "waiting");
    if (interaction) return interaction;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("waiting interaction did not appear");
}

function selection(interaction, option) {
  return {
    interaction_id: interaction.interaction_id,
    project_id: interaction.project_id,
    session_id: interaction.session_id,
    episode_id: interaction.episode_id,
    packet_id: interaction.packet_id,
    revision: interaction.revision,
    option_id: option.option_id,
  };
}

async function startDecisionWait(socketPath, episode, value = proposal()) {
  await emitProposal(socketPath, episode, value);
  const stopPromise = rpc(socketPath, "stop", {
    hook_event_name: "Stop",
    session_id: episode.sessionId,
    turn_id: episode.turnId,
    cwd: episode.cwd,
    stop_hook_active: false,
    last_assistant_message: "M0 work is complete.",
  });
  const interaction = await waitForWaitingInteraction(socketPath);
  return { stopPromise, interaction };
}

test("M0 constants pin 2s connect, 60s reminder, and 120s expiry", () => {
  assert.equal(DEFAULT_CONNECT_TIMEOUT_MS, 2_000);
  assert.equal(DEFAULT_WAIT_REMINDER_MS, 60_000);
  assert.equal(DEFAULT_WAIT_EXPIRY_MS, 120_000);
});

test("coordinator socket is restricted to the current user", async () => {
  await withServer(async ({ socketPath }) => {
    const socket = await lstat(socketPath);
    assert.equal(socket.mode & 0o777, 0o600);
  });
});

test("sentinel smoke parser is strict and isolated from operational manifests", async () => {
  const value = proposal();
  const text = `human text\n${SENTINEL_START}\n${JSON.stringify(value)}\n${SENTINEL_END}\n`;
  assert.deepEqual(parseSentinelOnce(text), value);
  assert.equal(parseSentinelOnce("ordinary response"), null);
  assert.throws(() => parseSentinelOnce(`${text}${text}`), /multiple_sentinels/);

  const operational = await Promise.all([
    readFile(path.join(m0Root, "plugins/blabee-m0/.codex-plugin/plugin.json"), "utf8"),
    readFile(path.join(m0Root, "plugins/blabee-m0/.mcp.json"), "utf8"),
    readFile(path.join(m0Root, "plugins/blabee-m0/hooks/hooks.json"), "utf8"),
    readFile(hookScript, "utf8"),
    readFile(mcpScript, "utf8"),
  ]);
  assert.equal(operational.some((textValue) => textValue.includes("sentinel")), false);
});

test("SessionStart is conditional; UserPromptSubmit creates a human episode; PermissionRequest only notifies", async () => {
  await withServer(async ({ socketPath }) => {
    const env = { BLABEE_M0_SOCKET: socketPath };
    const cwd = "/tmp/blabee-enabled-project";
    const disabled = await runNode(hookScript, ["SessionStart"], {
      env,
      input: JSON.stringify({ session_id: "s-disabled", cwd, source: "startup" }),
    });
    assert.equal(disabled.code, 0);
    assert.equal(disabled.stdout, "");

    await rpc(socketPath, "enable_project", { cwd, project_id: "project-enabled" });
    const started = await runNode(hookScript, ["SessionStart"], {
      env,
      input: JSON.stringify({ session_id: "s-enabled", cwd, source: "startup" }),
    });
    const startOutput = JSON.parse(started.stdout);
    assert.equal(startOutput.hookSpecificOutput.hookEventName, "SessionStart");
    assert.match(startOutput.hookSpecificOutput.additionalContext, /project-enabled/);
    assert.match(startOutput.hookSpecificOutput.additionalContext, /explanations/);

    const submitted = await runNode(hookScript, ["UserPromptSubmit"], {
      env,
      input: JSON.stringify({
        session_id: "s-enabled",
        turn_id: "t-human",
        cwd,
        prompt: "Implement a feature",
      }),
    });
    const submitOutput = JSON.parse(submitted.stdout);
    assert.equal(submitOutput.hookSpecificOutput.hookEventName, "UserPromptSubmit");
    assert.match(submitOutput.hookSpecificOutput.additionalContext, /episode_id=/);
    assert.match(submitOutput.hookSpecificOutput.additionalContext, /correlation_token=/);

    const permission = await runNode(hookScript, ["PermissionRequest"], {
      env,
      input: JSON.stringify({
        session_id: "s-enabled",
        turn_id: "t-human",
        cwd,
        tool_name: "Bash",
      }),
    });
    assert.equal(permission.code, 0);
    assert.equal(permission.stdout, "");
    const state = await rpc(socketPath, "get_state");
    const notice = state.events.find((event) => event.type === "native_permission_notice");
    assert.equal(notice.payload.tool_name, "Bash");
    assert.equal(JSON.stringify(notice).includes("allow"), false);
    assert.equal(JSON.stringify(notice).includes("deny"), false);
  });
});

test("reusing a session id in another project clears the previous episode binding", async () => {
  await withServer(async ({ socketPath }) => {
    const first = await beginEpisode(socketPath, {
      cwd: "/tmp/blabee-project-one",
      projectId: "project-one",
      sessionId: "shared-session",
      turnId: "turn-one",
    });
    assert.equal(first.ids.project_id, "project-one");
    await emitProposal(socketPath, first);
    const oldStopPromise = rpc(socketPath, "stop", {
      session_id: first.sessionId,
      turn_id: first.turnId,
      stop_hook_active: false,
    });
    await waitForWaitingInteraction(socketPath);

    await rpc(socketPath, "enable_project", {
      cwd: "/tmp/blabee-project-two",
      project_id: "project-two",
    });
    await rpc(socketPath, "session_start", {
      session_id: "shared-session",
      cwd: "/tmp/blabee-project-two",
      source: "resume",
    });

    const state = await rpc(socketPath, "get_state");
    const rebound = state.sessions.find((session) => session.session_id === "shared-session");
    assert.equal(rebound.project_id, "project-two");
    assert.equal(rebound.episode, null);
    assert.equal(rebound.latest_turn_id, null);
    assert.equal(rebound.latest_prompt_id, null);
    assert.equal(rebound.correlation_token, null);
    assert.deepEqual(await oldStopPromise, {
      status: "superseded",
      reason: "project_rebound",
    });
    assert.deepEqual(
      await rpc(socketPath, "stop", {
        session_id: first.sessionId,
        turn_id: first.turnId,
        stop_hook_active: true,
      }),
      { status: "no_proposal" },
    );
    assert.ok(
      state.events.some(
        (event) =>
          event.type === "session_routing_retired" &&
          event.payload.session_id === first.sessionId,
      ),
    );
  });
});

test("hooks fail open with exit 0 and no automation when the coordinator is unavailable", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "blabee-m0-missing-"));
  try {
    const missingSocket = path.join(temp, "missing.sock");
    for (const eventName of ["SessionStart", "UserPromptSubmit", "Stop", "PermissionRequest"]) {
      const input = {
        session_id: "missing-session",
        turn_id: "missing-turn",
        cwd: temp,
        prompt: "No coordinator",
        stop_hook_active: false,
        last_assistant_message: "done",
      };
      const run = await runNode(hookScript, [eventName], {
        env: { BLABEE_M0_SOCKET: missingSocket },
        input: JSON.stringify(input),
      });
      assert.equal(run.code, 0, `${eventName}: ${run.stderr}`);
      assert.equal(run.stdout, "", eventName);
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("MCP emit_decision exposes one tool and forwards exact identifiers and proposal", async () => {
  await withServer(async ({ socketPath }) => {
    const episode = await beginEpisode(socketPath);
    const value = {
      ...proposal({ suffix: "MCP" }),
      correlation_token: episode.ids.correlation_token,
    };
    const messages = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
      { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "emit_decision",
          arguments: {
            project_id: episode.ids.project_id,
            session_id: episode.ids.session_id,
            source_turn_id: episode.ids.source_turn_id,
            source_prompt_id: episode.ids.source_prompt_id,
            episode_id: episode.ids.episode_id,
            correlation_token: episode.ids.correlation_token,
            proposal: value,
          },
        },
      },
    ];
    const run = await runNode(mcpScript, [], {
      env: { BLABEE_M0_SOCKET: socketPath },
      input: `${messages.map(JSON.stringify).join("\n")}\n`,
    });
    assert.equal(run.code, 0, run.stderr);
    const replies = run.stdout.trim().split("\n").map(JSON.parse);
    assert.equal(replies.length, 3);
    assert.equal(replies[0].result.serverInfo.name, "blabee-m0");
    assert.deepEqual(replies[1].result.tools.map((tool) => tool.name), ["emit_decision"]);
    assert.equal(replies[2].result.structuredContent.accepted, true);

    const state = await rpc(socketPath, "get_state");
    const received = state.events.find((event) => event.type === "decision_proposal_received");
    assert.equal(received.payload.session_id, episode.sessionId);
    assert.equal(received.payload.source_turn_id, episode.turnId);
    assert.deepEqual(received.payload.proposal, value);
  });
});

test("Stop accepts only the exact pending turn and slot 1 returns a sealed full continuation", async () => {
  await withServer(async ({ socketPath, coordinator }) => {
    const episode = await beginEpisode(socketPath);
    await emitProposal(socketPath, episode, proposal({ suffix: "ONE" }));
    const unrelatedStop = await rpc(socketPath, "stop", {
      session_id: episode.sessionId,
      turn_id: "different-turn",
    });
    assert.deepEqual(unrelatedStop, { status: "no_proposal" });

    const stopHookPromise = runNode(hookScript, ["Stop"], {
      env: { BLABEE_M0_SOCKET: socketPath, BLABEE_M0_DEBUG: "1" },
      input: JSON.stringify({
        hook_event_name: "Stop",
        session_id: episode.sessionId,
        turn_id: episode.turnId,
        cwd: episode.cwd,
        stop_hook_active: false,
        last_assistant_message: "complete",
      }),
    });
    const interaction = await waitForWaitingInteraction(socketPath);
    const recommended = interaction.choices.find((option) => option.slot === 1);

    await assert.rejects(
      rpc(socketPath, "select", { ...selection(interaction, recommended), revision: 99 }),
      /selection_binding_mismatch:revision/,
    );
    const selected = await rpc(socketPath, "select", selection(interaction, recommended));
    assert.equal(selected.accepted, true);
    const stopHook = await stopHookPromise;
    assert.equal(stopHook.code, 0, stopHook.stderr);
    const stopResult = JSON.parse(stopHook.stdout);
    assert.equal(stopResult.decision, "block");
    assert.notEqual(stopResult.reason.trim(), "1");
    const envelope = parseContinuationPrompt(stopResult.reason);
    assert.match(stopHook.stderr, /"reason_redacted":true/);
    assert.equal(stopHook.stderr.includes(envelope.continuation_token), false);
    assert.equal(stopHook.stderr.includes(envelope.action.title), false);
    assert.equal(stopHook.stderr.includes("BLABEE_M0_CONTINUATION_V1"), false);
    assert.equal(envelope.packet_id, interaction.packet_id);
    assert.equal(envelope.revision, interaction.revision);
    assert.equal(envelope.option_id, recommended.option_id);
    assert.equal(envelope.action_id, recommended.action_id);
    assert.equal(envelope.action.title, "Recommended ONE");
    assert.deepEqual(envelope.action.done_when, ["contract test passes"]);

    let state = await rpc(socketPath, "get_state");
    assert.equal(state.events.filter((event) => event.type === "continuation_dispatched").length, 1);
    assert.equal(state.events.filter((event) => event.type === "continuation_consumed").length, 0);

    const wrongFlag = await rpc(socketPath, "stop", {
      session_id: episode.sessionId,
      turn_id: episode.turnId,
      stop_hook_active: false,
    });
    assert.deepEqual(wrongFlag, {
      status: "continuation_completion_rejected",
      reason: "stop_hook_not_active",
    });
    assert.deepEqual(
      await rpc(socketPath, "stop", {
        session_id: episode.sessionId,
        turn_id: "wrong-turn",
        stop_hook_active: true,
      }),
      { status: "no_proposal" },
    );
    assert.deepEqual(
      await rpc(socketPath, "stop", {
        session_id: "wrong-session",
        turn_id: episode.turnId,
        stop_hook_active: true,
      }),
      { status: "no_proposal" },
    );

    const completionHook = await runNode(hookScript, ["Stop"], {
      env: { BLABEE_M0_SOCKET: socketPath },
      input: JSON.stringify({
        hook_event_name: "Stop",
        session_id: episode.sessionId,
        turn_id: episode.turnId,
        cwd: episode.cwd,
        stop_hook_active: true,
        last_assistant_message: "continuation finished",
      }),
    });
    assert.equal(completionHook.code, 0, completionHook.stderr);
    assert.equal(completionHook.stdout, "");

    state = await rpc(socketPath, "get_state");
    assert.equal(state.dispatches[0].state, "completed");
    assert.equal(state.events.filter((event) => event.type === "continuation_consumed").length, 1);
    assert.equal(state.events.filter((event) => event.type === "continuation_completed").length, 1);

    const duplicateCompletion = await runNode(hookScript, ["Stop"], {
      env: { BLABEE_M0_SOCKET: socketPath },
      input: JSON.stringify({
        hook_event_name: "Stop",
        session_id: episode.sessionId,
        turn_id: episode.turnId,
        cwd: episode.cwd,
        stop_hook_active: true,
        last_assistant_message: "duplicate stop",
      }),
    });
    assert.equal(duplicateCompletion.code, 0, duplicateCompletion.stderr);
    assert.equal(duplicateCompletion.stdout, "");
    state = await rpc(socketPath, "get_state");
    assert.equal(state.events.filter((event) => event.type === "continuation_consumed").length, 1);
    assert.equal(state.events.filter((event) => event.type === "continuation_completed").length, 1);

    const replay = await rpc(socketPath, "user_prompt_submit", {
      session_id: episode.sessionId,
      turn_id: "turn-replay",
      cwd: episode.cwd,
      prompt: stopResult.reason,
    });
    assert.equal(replay.decision, "block");
    assert.match(replay.reason, /dispatch_mode_mismatch/);
    const stored = [...coordinator.continuations.values()][0];
    assert.equal("continuation_token" in stored.envelope, false);
  });
});

test("one turn can complete two contiguous decision continuations exactly once", async () => {
  await withServer(async ({ socketPath }) => {
    const episode = await beginEpisode(socketPath, {
      sessionId: "repeat-session",
      turnId: "repeat-turn",
      prompt: "Run two decision boundaries in one turn",
    });

    const firstProposal = await emitProposal(
      socketPath,
      episode,
      proposal({ suffix: "REPEAT-ONE" }),
    );
    assert.equal(firstProposal.packet.boundary_sequence, 1);
    await assert.rejects(
      emitProposal(socketPath, episode, proposal({ suffix: "DUPLICATE-PENDING" })),
      /proposal_already_exists_for_turn/,
    );

    const firstStopPromise = rpc(socketPath, "stop", {
      hook_event_name: "Stop",
      session_id: episode.sessionId,
      turn_id: episode.turnId,
      cwd: episode.cwd,
      stop_hook_active: false,
      last_assistant_message: "first boundary ready",
    });
    const firstInteraction = await waitForWaitingInteraction(socketPath);
    await assert.rejects(
      emitProposal(socketPath, episode, proposal({ suffix: "DUPLICATE-WAITING" })),
      /proposal_already_exists_for_turn/,
    );
    const firstOption = firstInteraction.choices.find((option) => option.slot === 1);
    await rpc(socketPath, "select", selection(firstInteraction, firstOption));
    const firstStop = await firstStopPromise;
    assert.equal(firstStop.decision, "block");
    const firstContinuation = parseContinuationPrompt(firstStop.reason);

    const secondProposal = await emitProposal(
      socketPath,
      episode,
      proposal({ suffix: "REPEAT-TWO" }),
    );
    assert.equal(secondProposal.packet.boundary_sequence, 2);
    await assert.rejects(
      emitProposal(socketPath, episode, proposal({ suffix: "DUPLICATE-STAGED" })),
      /proposal_already_exists_for_turn/,
    );

    const secondStopPromise = rpc(socketPath, "stop", {
      hook_event_name: "Stop",
      session_id: episode.sessionId,
      turn_id: episode.turnId,
      cwd: episode.cwd,
      stop_hook_active: true,
      last_assistant_message: "first continuation staged the next boundary",
    });
    const secondInteraction = await waitForWaitingInteraction(socketPath);
    assert.notEqual(secondInteraction.interaction_id, firstInteraction.interaction_id);
    const secondOption = secondInteraction.choices.find((option) => option.slot === 2);
    await rpc(socketPath, "select", selection(secondInteraction, secondOption));
    const secondStop = await secondStopPromise;
    assert.equal(secondStop.decision, "block");
    const secondContinuation = parseContinuationPrompt(secondStop.reason);

    assert.notEqual(secondProposal.packet.packet_id, firstProposal.packet.packet_id);
    assert.notEqual(secondContinuation.continuation_id, firstContinuation.continuation_id);
    assert.equal(firstContinuation.option_id, firstOption.option_id);
    assert.equal(secondContinuation.option_id, secondOption.option_id);

    assert.deepEqual(
      await rpc(socketPath, "stop", {
        hook_event_name: "Stop",
        session_id: episode.sessionId,
        turn_id: episode.turnId,
        cwd: episode.cwd,
        stop_hook_active: true,
        last_assistant_message: "second continuation finished",
      }),
      { status: "continuation_completed" },
    );
    assert.deepEqual(
      await rpc(socketPath, "stop", {
        hook_event_name: "Stop",
        session_id: episode.sessionId,
        turn_id: episode.turnId,
        cwd: episode.cwd,
        stop_hook_active: true,
        last_assistant_message: "duplicate terminal Stop",
      }),
      { status: "continuation_already_completed" },
    );

    const state = await rpc(socketPath, "get_state");
    const packets = state.packets
      .filter((packet) => packet.session_id === episode.sessionId)
      .sort((left, right) => left.boundary_sequence - right.boundary_sequence);
    assert.deepEqual(packets.map((packet) => packet.boundary_sequence), [1, 2]);
    for (const packet of packets) {
      assert.equal(packet.session_id, episode.ids.session_id);
      assert.equal(packet.source_turn_id, episode.ids.source_turn_id);
      assert.equal(packet.source_prompt_id, episode.ids.source_prompt_id);
      assert.equal(packet.episode_id, episode.ids.episode_id);
      assert.equal(packet.episode_root_prompt_id, episode.ids.episode_root_prompt_id);
      assert.equal(
        packet.episode_baseline_checkpoint_id,
        episode.ids.episode_baseline_checkpoint_id,
      );
    }

    const eventCount = (type) => state.events.filter((event) => event.type === type).length;
    assert.equal(eventCount("decision_proposal_received"), 2);
    assert.equal(eventCount("decision_wait_started"), 2);
    assert.equal(eventCount("pet_action_selected"), 2);
    assert.equal(eventCount("continuation_dispatched"), 2);
    assert.equal(eventCount("continuation_consumed"), 2);
    assert.equal(eventCount("continuation_completed"), 2);
    assert.deepEqual(state.dispatches.map((dispatch) => dispatch.state), ["completed", "completed"]);
  });
});

test("submitted-envelope tokens reject binding, body, and extra-field tampering", async () => {
  await withServer(async ({ socketPath }) => {
    const episode = await beginEpisode(socketPath, { sessionId: "bound-session", turnId: "bound-turn" });
    const issued = await rpc(socketPath, "issue_format_repair", {
      project_id: episode.projectId,
      session_id: episode.sessionId,
      parent_turn_id: episode.turnId,
      parent_prompt_id: episode.ids.source_prompt_id,
      repair_kind: "decision_proposal_schema",
    });
    const envelope = parseContinuationPrompt(issued.continuation_prompt);

    const cases = [
      ["session_id", "other-session", "envelope_session_mismatch"],
      ["episode_id", "other-episode", "envelope_episode_mismatch"],
      ["parent_turn_id", "other-parent", "envelope_parent_turn_mismatch"],
      ["continuation_id", "other-continuation", "envelope_body_mismatch"],
      ["expires_at", "2099-01-01T00:00:00.000Z", "envelope_body_mismatch"],
      ["repair_kind", "different_repair", "envelope_body_mismatch"],
    ];
    for (const [field, replacement, expected] of cases) {
      const tampered = { ...envelope, [field]: replacement };
      const rejected = await rpc(socketPath, "user_prompt_submit", {
        session_id: episode.sessionId,
        turn_id: `tampered-${field}`,
        cwd: episode.cwd,
        prompt: `BLABEE_M0_CONTINUATION_V1\n${JSON.stringify(tampered)}`,
      });
      assert.equal(rejected.decision, "block");
      assert.match(rejected.reason, new RegExp(expected));
    }

    const withExtraField = {
      ...envelope,
      injected_instruction: "this must not be accepted",
    };
    const rejectedExtra = await rpc(socketPath, "user_prompt_submit", {
      session_id: episode.sessionId,
      turn_id: "tampered-extra-field",
      cwd: episode.cwd,
      prompt: `BLABEE_M0_CONTINUATION_V1\n${JSON.stringify(withExtraField)}`,
    });
    assert.equal(rejectedExtra.decision, "block");
    assert.match(rejectedExtra.reason, /envelope_body_mismatch/);
  });
});

test("pet-action continuation is locked to same-turn Stop and cannot run through UserPromptSubmit", async () => {
  await withServer(async ({ socketPath }) => {
    const episode = await beginEpisode(socketPath, {
      sessionId: "explicit-envelope-session",
      turnId: "explicit-envelope-parent",
    });
    const { stopPromise, interaction } = await startDecisionWait(socketPath, episode);
    const recommended = interaction.choices.find((option) => option.slot === 1);
    await rpc(socketPath, "select", selection(interaction, recommended));
    const stopResult = await stopPromise;

    const rejected = await rpc(socketPath, "user_prompt_submit", {
      session_id: episode.sessionId,
      turn_id: "explicit-envelope-child",
      cwd: episode.cwd,
      prompt: stopResult.reason,
    });
    assert.equal(rejected.decision, "block");
    assert.match(rejected.reason, /dispatch_mode_mismatch/);

    assert.deepEqual(
      await rpc(socketPath, "stop", {
        session_id: episode.sessionId,
        turn_id: episode.turnId,
        stop_hook_active: true,
      }),
      { status: "continuation_completed" },
    );
    const state = await rpc(socketPath, "get_state");
    assert.equal(state.events.filter((event) => event.type === "continuation_consumed").length, 1);
    assert.equal(state.events.filter((event) => event.type === "continuation_completed").length, 1);
  });
});

test("a continuation token expires independently of the Stop wait", async () => {
  let nowMs = 1_000;
  const coordinator = new FakeCoordinator({
    continuationTtlMs: 10,
    now: () => nowMs,
  });
  await withServer(async ({ socketPath }) => {
    const episode = await beginEpisode(socketPath, {
      sessionId: "token-expiry-session",
      turnId: "token-expiry-parent",
    });
    const issued = await rpc(socketPath, "issue_format_repair", {
      project_id: episode.projectId,
      session_id: episode.sessionId,
      parent_turn_id: episode.turnId,
      parent_prompt_id: episode.ids.source_prompt_id,
      repair_kind: "decision_proposal_schema",
    });
    nowMs = 1_011;
    const rejected = await rpc(socketPath, "user_prompt_submit", {
      session_id: episode.sessionId,
      turn_id: "token-expiry-child",
      cwd: episode.cwd,
      prompt: issued.continuation_prompt,
    });
    assert.equal(rejected.decision, "block");
    assert.match(rejected.reason, /token_expired/);
  }, coordinator);
});

test("slot 2 is dynamic or disabled without repurposing", async () => {
  await withServer(async ({ socketPath }) => {
    const episode = await beginEpisode(socketPath, { sessionId: "slot2-enabled", turnId: "turn-2a" });
    const active = await startDecisionWait(socketPath, episode, proposal({ suffix: "TWO" }));
    const alternative = active.interaction.choices.find((option) => option.slot === 2);
    assert.equal(alternative.kind, "alternative_action");
    assert.equal(alternative.title, "Alternative TWO");
    await rpc(socketPath, "select", selection(active.interaction, alternative));
    const continuation = parseContinuationPrompt((await active.stopPromise).reason);
    assert.equal(continuation.action.title, "Alternative TWO");

    const noAlternativeEpisode = await beginEpisode(socketPath, {
      sessionId: "slot2-disabled",
      turnId: "turn-2b",
    });
    const disabled = await startDecisionWait(
      socketPath,
      noAlternativeEpisode,
      proposal({ alternative: false }),
    );
    const disabledAlternative = disabled.interaction.choices.find((option) => option.slot === 2);
    assert.equal(disabledAlternative.enabled, false);
    assert.equal(disabledAlternative.disabled_reason, "no_safe_meaningful_alternative");
    assert.equal(disabledAlternative.action_id, null);
    assert.equal("title" in disabledAlternative, false);
    await assert.rejects(
      rpc(socketPath, "select", selection(disabled.interaction, disabledAlternative)),
      /option_disabled:no_safe_meaningful_alternative/,
    );
    const pause = disabled.interaction.choices.find((option) => option.slot === 3);
    await rpc(socketPath, "select", selection(disabled.interaction, pause));
    await disabled.stopPromise;
  });
});

test("slot 3 pauses and slot 4 emits rollback intent without pretending to restore", async () => {
  await withServer(async ({ socketPath }) => {
    const pauseEpisode = await beginEpisode(socketPath, {
      sessionId: "pause-session",
      turnId: "pause-turn",
    });
    const pauseWait = await startDecisionWait(socketPath, pauseEpisode);
    const pause = pauseWait.interaction.choices.find((option) => option.slot === 3);
    await rpc(socketPath, "select", selection(pauseWait.interaction, pause));
    assert.deepEqual(await pauseWait.stopPromise, { status: "paused" });

    const rollbackEpisode = await beginEpisode(socketPath, {
      sessionId: "rollback-session",
      turnId: "rollback-turn",
    });
    const rollbackWait = await startDecisionWait(socketPath, rollbackEpisode);
    const rollback = rollbackWait.interaction.choices.find((option) => option.slot === 4);
    await rpc(socketPath, "select", selection(rollbackWait.interaction, rollback));
    const rollbackResult = await rollbackWait.stopPromise;
    assert.equal(rollbackResult.status, "rollback_intent");
    assert.equal(
      rollbackResult.target_checkpoint_id,
      rollbackEpisode.ids.episode_baseline_checkpoint_id,
    );

    const state = await rpc(socketPath, "get_state");
    assert.ok(state.events.some((event) => event.type === "episode_paused"));
    const pausedState = state.interactions.find(
      (interaction) => interaction.interaction_id === pauseWait.interaction.interaction_id,
    );
    assert.equal(pausedState.state, "paused");
    const intent = state.events.find((event) => event.type === "rollback_intent");
    assert.equal(intent.payload.episode_root_prompt_id, rollbackEpisode.ids.episode_root_prompt_id);
    assert.equal(intent.payload.target_checkpoint_id, rollbackEpisode.ids.episode_baseline_checkpoint_id);
    const rollbackState = state.interactions.find(
      (interaction) => interaction.interaction_id === rollbackWait.interaction.interaction_id,
    );
    assert.equal(rollbackState.state, "rollback_intent");
    assert.equal(state.events.some((event) => event.type === "rollback_completed"), false);
  });
});

test("short injected deadlines prove one reminder, expiry, no auto-choice, and late selection rejection", async () => {
  const coordinator = new FakeCoordinator({ reminderMs: 10, expiryMs: 30 });
  await withServer(async ({ socketPath }) => {
    const episode = await beginEpisode(socketPath, { sessionId: "expiry-session", turnId: "expiry-turn" });
    const wait = await startDecisionWait(socketPath, episode);
    assert.deepEqual(await wait.stopPromise, { status: "expired" });
    const state = await rpc(socketPath, "get_state");
    assert.equal(state.events.filter((event) => event.type === "decision_wait_reminder").length, 1);
    assert.equal(state.events.filter((event) => event.type === "decision_wait_expired").length, 1);
    assert.equal(state.events.some((event) => event.type === "pet_action_selected"), false);
    const recommended = wait.interaction.choices.find((option) => option.slot === 1);
    await assert.rejects(
      rpc(socketPath, "select", selection(wait.interaction, recommended)),
      /interaction_not_waiting/,
    );
  }, coordinator);
});

test("internal format repair stays in the episode and is one-time", async () => {
  await withServer(async ({ socketPath, coordinator }) => {
    const episode = await beginEpisode(socketPath, { sessionId: "repair-session", turnId: "repair-parent" });
    const issued = await rpc(socketPath, "issue_format_repair", {
      project_id: episode.projectId,
      session_id: episode.sessionId,
      parent_turn_id: episode.turnId,
      parent_prompt_id: episode.ids.source_prompt_id,
      repair_kind: "decision_proposal_schema",
    });
    assert.equal(issued.envelope.repair_attempt, 1);
    assert.equal(issued.envelope.max_repair_attempts, 1);
    assert.equal("packet_id" in issued.envelope, false);
    assert.equal("option_id" in issued.envelope, false);
    assert.equal("action_id" in issued.envelope, false);
    const stored = [...coordinator.continuations.values()][0];
    assert.equal("continuation_token" in stored.envelope, false);
    await assert.rejects(
      rpc(socketPath, "issue_format_repair", {
        project_id: episode.projectId,
        session_id: episode.sessionId,
        parent_turn_id: episode.turnId,
        parent_prompt_id: episode.ids.source_prompt_id,
        repair_kind: "decision_proposal_schema",
      }),
      /format_repair_limit_reached/,
    );
    await assert.rejects(
      rpc(socketPath, "issue_format_repair", {
        project_id: episode.projectId,
        session_id: episode.sessionId,
        parent_turn_id: episode.turnId,
        parent_prompt_id: episode.ids.source_prompt_id,
        repair_kind: "different_schema",
      }),
      /unsupported_repair_kind:different_schema/,
    );

    const accepted = await rpc(socketPath, "user_prompt_submit", {
      session_id: episode.sessionId,
      turn_id: "repair-turn",
      cwd: episode.cwd,
      prompt: issued.continuation_prompt,
    });
    assert.equal(accepted.prompt_origin, "internal_format_repair");
    assert.equal(accepted.identifiers.episode_id, episode.ids.episode_id);

    const replay = await rpc(socketPath, "user_prompt_submit", {
      session_id: episode.sessionId,
      turn_id: "repair-replay",
      cwd: episode.cwd,
      prompt: issued.continuation_prompt,
    });
    assert.equal(replay.decision, "block");
    assert.match(replay.reason, /token_replayed/);
  });
});

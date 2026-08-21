#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { requestJsonl } from "../coordinator/jsonl-client.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const m0Root = path.resolve(here, "..");
const pluginRoot = path.join(m0Root, "plugins", "blabee-m0");
const coordinatorEntry = path.join(m0Root, "coordinator", "server.mjs");
const hookEntry = path.join(pluginRoot, "scripts", "hook.mjs");
const mcpEntry = path.join(pluginRoot, "scripts", "mcp-server.mjs");
const SENSITIVE_DIAGNOSTIC_KEYS = new Set(["correlation_token", "continuation_token"]);
const REDACTED_DIAGNOSTIC_VALUE = "<redacted>";

function collectDiagnosticSecrets(value, secrets = new Set(), encodedDepth = 0) {
  if (typeof value === "string") {
    for (const match of value.matchAll(
      /"(?:correlation|continuation)_token"\s*:\s*"([^"]*)"/g,
    )) {
      if (match[1].length > 0) secrets.add(match[1]);
    }
    for (const match of value.matchAll(
      /\\"(?:correlation|continuation)_token\\"\s*:\s*\\"([^"\\]*)\\"/g,
    )) {
      if (match[1].length > 0) secrets.add(match[1]);
    }
    for (const match of value.matchAll(
      /(?:correlation|continuation)_token\s*=\s*([^;\s."']+)/g,
    )) {
      if (match[1].length > 0) secrets.add(match[1]);
    }
    if (encodedDepth < 4) {
      for (const line of value.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) continue;
        try {
          collectDiagnosticSecrets(JSON.parse(trimmed), secrets, encodedDepth + 1);
        } catch {
          // Diagnostic input may mix JSONL and plain text. Regex redaction still applies.
        }
      }
    }
    return secrets;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectDiagnosticSecrets(item, secrets, encodedDepth);
    return secrets;
  }
  if (!value || typeof value !== "object") return secrets;

  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_DIAGNOSTIC_KEYS.has(key) && typeof item === "string" && item.length > 0) {
      secrets.add(item);
    }
    collectDiagnosticSecrets(item, secrets, encodedDepth);
  }
  return secrets;
}

function redactDiagnosticString(value, secrets, encodedDepth) {
  let redacted = value;
  for (const secret of secrets) redacted = redacted.replaceAll(secret, REDACTED_DIAGNOSTIC_VALUE);
  redacted = redacted
    .replace(
      /(\\"(?:correlation|continuation)_token\\"\s*:\s*\\")[^"\\]*(\\")/g,
      `$1${REDACTED_DIAGNOSTIC_VALUE}$2`,
    )
    .replace(
      /("(?:correlation|continuation)_token"\s*:\s*")[^"]*(")/g,
      `$1${REDACTED_DIAGNOSTIC_VALUE}$2`,
    )
    .replace(
      /((?:correlation|continuation)_token\s*=\s*)[^;\s."']+/g,
      `$1${REDACTED_DIAGNOSTIC_VALUE}`,
    );

  if (encodedDepth >= 4) return redacted;
  let parsedAny = false;
  const lines = redacted.split("\n").map((line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return line;
    try {
      parsedAny = true;
      return JSON.stringify(
        redactDiagnosticNode(JSON.parse(trimmed), secrets, encodedDepth + 1),
      );
    } catch {
      return line;
    }
  });
  return parsedAny ? lines.join("\n") : redacted;
}

function redactDiagnosticNode(value, secrets, encodedDepth = 0) {
  if (typeof value === "string") {
    return redactDiagnosticString(value, secrets, encodedDepth);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactDiagnosticNode(item, secrets, encodedDepth));
  }
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_DIAGNOSTIC_KEYS.has(key)
        ? REDACTED_DIAGNOSTIC_VALUE
        : redactDiagnosticNode(item, secrets, encodedDepth),
    ]),
  );
}

export function redactDiagnostics(value) {
  return redactDiagnosticNode(value, collectDiagnosticSecrets(value));
}

function quoteShell(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function quoteToml(value) {
  return JSON.stringify(String(value));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status}): ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
}

function parseCodexJsonl(output) {
  return output
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

async function waitForLine(stream, predicate, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("process_ready_timeout"));
    }, timeoutMs);
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      while (buffer.includes("\n")) {
        const newline = buffer.indexOf("\n");
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (predicate(line)) {
          cleanup();
          resolve(line);
          return;
        }
      }
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`process_exited_before_ready:${code}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      stream.off("data", onData);
      stream.off("close", onExit);
    };
    stream.on("data", onData);
    stream.on("close", onExit);
  });
}

async function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("codex_contract_timeout"));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function pollAndSelect({ socketPath, codexChild, timeoutMs = 60_000 }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && codexChild.exitCode === null) {
    try {
      const state = await requestJsonl({
        socketPath,
        type: "get_state",
        responseTimeoutMs: 1_000,
      });
      const interaction = state.interactions.find((item) => item.state === "waiting");
      if (interaction) {
        const option = interaction.choices.find((choice) => choice.slot === 1 && choice.enabled);
        assert.ok(option, "waiting interaction must expose enabled recommended action");
        const result = await requestJsonl({
          socketPath,
          type: "select",
          payload: {
            interaction_id: interaction.interaction_id,
            project_id: interaction.project_id,
            session_id: interaction.session_id,
            episode_id: interaction.episode_id,
            packet_id: interaction.packet_id,
            revision: interaction.revision,
            option_id: option.option_id,
          },
          responseTimeoutMs: 2_000,
        });
        assert.equal(result.accepted, true);
        return { interaction, option };
      }
    } catch (error) {
      if (!String(error.message).includes("ENOENT")) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("decision_interaction_not_observed");
}

async function main() {
  const keepFixture = process.argv.includes("--keep-fixture");
  const projectMcpOnly = process.argv.includes("--project-mcp-only");
  const explanationOnly = process.argv.includes("--explanation-only");
  // macOS exposes /var through /private/var. Codex canonicalizes its cwd, so use
  // the same real path for trust, project binding, hooks, MCP, and coordinator IDs.
  const fixtureRoot = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "blabee-m0-codex-")),
  );
  const socketPath = path.join(fixtureRoot, "coordinator.sock");
  let coordinator;
  let codex;

  try {
    run("git", ["init", "-q", fixtureRoot]);
    run("git", ["-C", fixtureRoot, "config", "user.name", "Blabee M0"]);
    run("git", ["-C", fixtureRoot, "config", "user.email", "m0@example.invalid"]);
    await writeFile(path.join(fixtureRoot, "README.md"), "# Blabee M0 fixture\n", "utf8");
    run("git", ["-C", fixtureRoot, "add", "README.md"]);
    run("git", ["-C", fixtureRoot, "commit", "-q", "-m", "fixture baseline"]);

    const codexConfigDir = path.join(fixtureRoot, ".codex");
    const hookDebugLog = path.join(fixtureRoot, "hook-debug.log");
    await mkdir(codexConfigDir, { recursive: true });
    const hookCommand = (event) =>
      `env BLABEE_M0_SOCKET=${quoteShell(socketPath)} BLABEE_M0_DEBUG=1 ` +
      `${quoteShell(process.execPath)} ${quoteShell(hookEntry)} ${event} ` +
      `2>>${quoteShell(hookDebugLog)}`;
    await writeFile(
      path.join(codexConfigDir, "hooks.json"),
      `${JSON.stringify(
        {
          description: "Generated Blabee M0 live contract fixture.",
          hooks: {
            SessionStart: [
              {
                matcher: "startup|resume|clear|compact",
                hooks: [
                  {
                    type: "command",
                    command: hookCommand("SessionStart"),
                    timeout: 3,
                    additionalContextLimit: 600,
                  },
                ],
              },
            ],
            UserPromptSubmit: [
              {
                hooks: [
                  {
                    type: "command",
                    command: hookCommand("UserPromptSubmit"),
                    timeout: 3,
                    additionalContextLimit: 900,
                  },
                ],
              },
            ],
            Stop: [
              {
                hooks: [
                  { type: "command", command: hookCommand("Stop"), timeout: 35 },
                ],
              },
            ],
            PermissionRequest: [
              {
                hooks: [
                  { type: "command", command: hookCommand("PermissionRequest"), timeout: 3 },
                ],
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      path.join(codexConfigDir, "config.toml"),
      [
        "[features]",
        "hooks = true",
        "",
        "[mcp_servers.blabee]",
        `command = ${quoteToml(process.execPath)}`,
        `args = [${quoteToml(mcpEntry)}]`,
        `env = { BLABEE_M0_SOCKET = ${quoteToml(socketPath)} }`,
        "startup_timeout_sec = 3",
        "tool_timeout_sec = 10",
        "",
      ].join("\n"),
      "utf8",
    );

    coordinator = spawn(
      process.execPath,
      [
        coordinatorEntry,
        "--socket",
        socketPath,
        "--enabled-project",
        fixtureRoot,
        "--reminder-ms",
        "2_000".replace("_", ""),
        "--expiry-ms",
        "30_000".replace("_", ""),
      ],
      { cwd: fixtureRoot, stdio: ["ignore", "pipe", "pipe"] },
    );
    let coordinatorError = "";
    coordinator.stderr.on("data", (chunk) => {
      coordinatorError += chunk.toString("utf8");
    });
    await waitForLine(coordinator.stdout, (line) => JSON.parse(line).ready === true, 5_000);

    const prompt = explanationOnly
      ? "Read README.md and explain its purpose using exactly the single token M0_EXPLAINED. Do not edit any file."
      : [
          "This is the Blabee M0 live contract test.",
          "Create result.txt containing exactly M0_CREATED followed by one newline.",
          "Then call the Blabee emit_decision MCP tool exactly once, using every exact identifier from the Blabee boundary developer context.",
          "Copy that same boundary correlation_token into proposal.correlation_token as well.",
          "Use schema_version 1.0, interaction_kind blabee_decision, task_goal 'Stage first live continuation', outcome status completed and summary 'M0 file created'.",
          "Set recommended_next title to 'Stage the second M0 decision'.",
          "Set its objective to: Read result.txt, then call the Blabee emit_decision MCP tool exactly once using the same exact project_id, session_id, source_turn_id, source_prompt_id, episode_id, and correlation_token from the original Blabee boundary developer context. Copy that correlation_token into the second proposal. For the second proposal use schema_version 1.0, interaction_kind blabee_decision, task_goal 'Verify second live continuation', outcome status completed and summary 'Second M0 decision staged', recommended_next title 'Finish the second M0 continuation', objective 'Read result.txt and reply exactly M0_CONTINUED_TWICE without editing files or calling emit_decision again', constraints ['Do not edit files', 'Do not call emit_decision again'], done_when ['Final reply is exactly M0_CONTINUED_TWICE'], alternative_next null, pause_capsule {}, and reported_side_effects []. After the second MCP call is accepted, reply exactly M0_WAITING_2.",
          "Set the first recommended_next constraints to ['Do not edit files', 'Do not submit a new user prompt'] and done_when to ['Second decision proposal is accepted and reply is exactly M0_WAITING_2'].",
          "Set alternative_next to null, pause_capsule to {}, and reported_side_effects to [].",
          "After the first MCP tool call accepts the proposal, reply exactly M0_WAITING_1. When each Blabee continuation arrives, execute its full action.",
        ].join(" ");

    const mcpConfigOverride =
      "mcp_servers.blabee={ " +
      `command = ${quoteToml(process.execPath)}, ` +
      `args = [${quoteToml(mcpEntry)}], ` +
      `env = { BLABEE_M0_SOCKET = ${quoteToml(socketPath)} }, ` +
      "startup_timeout_sec = 3, tool_timeout_sec = 10, required = true }";
    const projectTrustOverride =
      `projects={ ${quoteToml(fixtureRoot)} = { trust_level = ${quoteToml("trusted")} } }`;

    const codexArgs = [
      "exec",
      "--json",
      "--ephemeral",
      "--ignore-user-config",
      "--dangerously-bypass-hook-trust",
      "--enable",
      "hooks",
    ];
    if (!projectMcpOnly) codexArgs.push("--config", mcpConfigOverride);
    codexArgs.push(
      "--config",
      projectTrustOverride,
      "--sandbox",
      "workspace-write",
      "-C",
      fixtureRoot,
      prompt,
    );

    codex = spawn(
      "codex",
      codexArgs,
      {
        cwd: fixtureRoot,
        env: { ...process.env, BLABEE_M0_SOCKET: socketPath },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let codexStdout = "";
    let codexStderr = "";
    codex.stdout.on("data", (chunk) => {
      codexStdout += chunk.toString("utf8");
    });
    codex.stderr.on("data", (chunk) => {
      codexStderr += chunk.toString("utf8");
    });

    const selections = [];
    try {
      if (!explanationOnly) {
        for (let cycle = 0; cycle < 2; cycle += 1) {
          selections.push(await pollAndSelect({ socketPath, codexChild: codex }));
        }
      }
    } catch (error) {
      let state = null;
      let hookDebug = "<empty>";
      try {
        state = await requestJsonl({ socketPath, type: "get_state" });
      } catch (stateError) {
        state = { unavailable: stateError.message };
      }
      try {
        hookDebug = await readFile(hookDebugLog, "utf8");
      } catch (hookDebugError) {
        if (hookDebugError.code !== "ENOENT") hookDebug = hookDebugError.message;
      }
      const diagnostics = redactDiagnostics({
        errorMessage: error.message,
        codexStdout,
        codexStderr,
        hookDebug,
        coordinatorError,
        state,
      });
      throw new Error(
        [
          diagnostics.errorMessage,
          `fixture_root=${fixtureRoot}`,
          `codex_exit_code=${codex.exitCode}`,
          `codex_stdout=${diagnostics.codexStdout || "<empty>"}`,
          `codex_stderr=${diagnostics.codexStderr || "<empty>"}`,
          `hook_debug=${diagnostics.hookDebug}`,
          `coordinator_stderr=${diagnostics.coordinatorError || "<empty>"}`,
          `coordinator_state=${JSON.stringify(diagnostics.state)}`,
        ].join("\n"),
        { cause: error },
      );
    }
    const exit = await waitForExit(codex, 120_000);
    if (exit.code !== 0) {
      let failureState = null;
      try {
        failureState = await requestJsonl({ socketPath, type: "get_state" });
      } catch (stateError) {
        failureState = { unavailable: stateError.message };
      }
      const diagnostics = redactDiagnostics({ codexStderr, state: failureState });
      throw new Error(
        `Codex failed with exit_code=${exit.code}: ${diagnostics.codexStderr || "<empty>"}`,
      );
    }

    const state = await requestJsonl({ socketPath, type: "get_state" });
    const eventTypes = state.events.map((event) => event.type);
    const requiredEvents = explanationOnly
      ? ["session_started", "human_episode_started"]
      : [
          "session_started",
          "human_episode_started",
          "decision_proposal_received",
          "decision_wait_started",
          "pet_action_selected",
          "continuation_dispatched",
          "continuation_consumed",
          "continuation_completed",
        ];
    for (const required of requiredEvents) {
      assert.ok(eventTypes.includes(required), `missing coordinator event: ${required}`);
    }
    const humanEpisodes = state.events.filter((event) => event.type === "human_episode_started");
    assert.equal(humanEpisodes.length, 1, "the live contract must keep one human episode");
    const [humanEpisode] = humanEpisodes;
    const codexEvents = parseCodexJsonl(codexStdout);
    const assistantMessages = codexEvents
      .filter((event) => event.type === "item.completed" && event.item?.type === "agent_message")
      .map((event) => event.item.text);
    const finalAssistantMessage = assistantMessages.at(-1)?.trim();
    if (explanationOnly) {
      assert.equal(eventTypes.includes("decision_proposal_received"), false);
      assert.equal(eventTypes.includes("decision_wait_started"), false);
      await assert.rejects(readFile(path.join(fixtureRoot, "result.txt")), { code: "ENOENT" });
      assert.equal(finalAssistantMessage, "M0_EXPLAINED");
    } else {
      const decisionEvents = state.events.filter(
        (event) => event.type === "decision_proposal_received",
      );
      const eventCount = (type) => state.events.filter((event) => event.type === type).length;
      for (const eventType of [
        "decision_proposal_received",
        "decision_wait_started",
        "pet_action_selected",
        "continuation_dispatched",
        "continuation_consumed",
        "continuation_completed",
      ]) {
        assert.equal(eventCount(eventType), 2, `${eventType} must occur once per boundary`);
      }
      const continuations = state.events.filter(
        (event) => event.type === "continuation_consumed",
      );
      const completions = state.events.filter(
        (event) => event.type === "continuation_completed",
      );
      assert.equal(decisionEvents.length, 2);
      assert.equal(continuations.length, 2);
      assert.equal(completions.length, 2);
      assert.deepEqual(
        decisionEvents.map((event) => event.payload.boundary_sequence),
        [1, 2],
      );
      assert.notEqual(decisionEvents[0].payload.packet_id, decisionEvents[1].payload.packet_id);
      assert.notEqual(
        continuations[0].payload.continuation_id,
        continuations[1].payload.continuation_id,
      );
      for (const decision of decisionEvents) {
        const packet = state.packets.find(
          (candidate) => candidate.packet_id === decision.payload.packet_id,
        );
        assert.ok(packet, `missing packet ${decision.payload.packet_id}`);
        assert.equal(packet.boundary_sequence, decision.payload.boundary_sequence);
        assert.equal(decision.payload.session_id, humanEpisode.payload.session_id);
        assert.equal(decision.payload.source_turn_id, humanEpisode.payload.source_turn_id);
        assert.equal(decision.payload.source_prompt_id, humanEpisode.payload.source_prompt_id);
        assert.equal(decision.payload.episode_id, humanEpisode.payload.episode_id);
        assert.equal(
          packet.episode_root_prompt_id,
          humanEpisode.payload.episode_root_prompt_id,
        );
        assert.equal(
          packet.episode_baseline_checkpoint_id,
          humanEpisode.payload.episode_baseline_checkpoint_id,
        );
      }
      for (const continuation of continuations) {
        assert.equal(continuation.payload.session_id, humanEpisode.payload.session_id);
        assert.equal(continuation.payload.episode_id, humanEpisode.payload.episode_id);
        assert.equal(continuation.payload.dispatch_mode, "same_turn_stop");
      }
      assert.deepEqual(
        selections.map((selection) => selection.interaction.packet_id),
        decisionEvents.map((event) => event.payload.packet_id),
      );
      assert.equal(await readFile(path.join(fixtureRoot, "result.txt"), "utf8"), "M0_CREATED\n");
      assert.equal(finalAssistantMessage, "M0_CONTINUED_TWICE");
    }

    process.stdout.write(
      `${JSON.stringify(
        {
          schema_version: "blabee.m0.codex-contract.v1",
          ok: true,
          codex_version: run("codex", ["--version"]).trim(),
          fixture_root: keepFixture ? fixtureRoot : null,
          session_id: humanEpisode.payload.session_id,
          episode_id: humanEpisode.payload.episode_id,
          contract_kind: explanationOnly ? "explanation_passthrough" : "decision_continuation",
          decision_cycle_count: selections.length,
          selected_packet_ids: selections.map((selection) => selection.interaction.packet_id),
          selected_option_ids: selections.map((selection) => selection.option.option_id),
          selected_packet_id: selections[0]?.interaction.packet_id ?? null,
          selected_option_id: selections[0]?.option.option_id ?? null,
          observed_events: eventTypes,
          final_assistant_message: finalAssistantMessage,
          mcp_config_source: projectMcpOnly
            ? "project_config_only"
            : "cli_override_plus_project_config",
          terminal_input_injection: false,
          separate_llm_api_key: false,
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    let failureState = null;
    try {
      failureState = await requestJsonl({ socketPath, type: "get_state" });
    } catch {
      // The coordinator may be the failed component. Named-field redaction still applies.
    }
    const diagnostics = redactDiagnostics({
      errorStack: error.stack ?? error.message,
      state: failureState,
    });
    throw new Error(diagnostics.errorStack);
  } finally {
    if (codex?.exitCode === null) codex.kill("SIGTERM");
    if (coordinator?.exitCode === null) coordinator.kill("SIGTERM");
    if (!keepFixture) await rm(fixtureRoot, { recursive: true, force: true });
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${redactDiagnostics(error.stack ?? error.message)}\n`);
    process.exitCode = 1;
  });
}

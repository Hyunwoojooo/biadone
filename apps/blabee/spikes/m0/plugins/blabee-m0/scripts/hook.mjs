#!/usr/bin/env node
import {
  coordinatorSocketPath,
  DEFAULT_RESPONSE_TIMEOUT_MS,
  requestCoordinator,
} from "./rpc-client.mjs";

const SUPPORTED_EVENTS = new Set([
  "SessionStart",
  "UserPromptSubmit",
  "Stop",
  "PermissionRequest",
]);

function responseFor(eventName, result) {
  if (!result || result.enabled === false) return null;
  if (eventName === "PermissionRequest") return null;
  if (result.decision === "block") {
    return { decision: "block", reason: result.reason };
  }
  if (
    (eventName === "SessionStart" || eventName === "UserPromptSubmit") &&
    typeof result.additionalContext === "string" &&
    result.additionalContext.length > 0
  ) {
    return {
      hookSpecificOutput: {
        hookEventName: eventName,
        additionalContext: result.additionalContext,
      },
    };
  }
  return null;
}

function debugSummary(eventName, result) {
  const summary = {
    event_name: eventName,
    enabled: result?.enabled ?? null,
    decision: result?.decision ?? null,
    status: result?.status ?? null,
  };
  if (result?.decision === "block" && typeof result.reason === "string") {
    summary.reason_redacted = true;
    summary.reason_bytes = Buffer.byteLength(result.reason, "utf8");
  }
  if (result?.identifiers) {
    summary.identifiers = {
      project_id: result.identifiers.project_id,
      session_id: result.identifiers.session_id,
      source_turn_id: result.identifiers.source_turn_id,
      source_prompt_id: result.identifiers.source_prompt_id,
      episode_id: result.identifiers.episode_id,
    };
  }
  return summary;
}

async function main() {
  const eventName = process.argv[2];
  if (!SUPPORTED_EVENTS.has(eventName)) return;

  let input;
  try {
    process.stdin.setEncoding("utf8");
    let inputText = "";
    for await (const chunk of process.stdin) inputText += chunk;
    input = JSON.parse(inputText);
  } catch (error) {
    if (process.env.BLABEE_M0_DEBUG === "1") {
      process.stderr.write(`[blabee-m0] invalid_input=${error.message}\n`);
    }
    return;
  }

  const socketPath = coordinatorSocketPath();
  if (!socketPath) return;
  const type = {
    SessionStart: "session_start",
    UserPromptSubmit: "user_prompt_submit",
    Stop: "stop",
    PermissionRequest: "permission_request",
  }[eventName];

  try {
    const result = await requestCoordinator({
      socketPath,
      type,
      payload: input,
      responseTimeoutMs: eventName === "Stop" ? DEFAULT_RESPONSE_TIMEOUT_MS : 5_000,
    });
    if (process.env.BLABEE_M0_DEBUG === "1") {
      process.stderr.write(`[blabee-m0] result=${JSON.stringify(debugSummary(eventName, result))}\n`);
    }
    const output = responseFor(eventName, result);
    if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
  } catch (error) {
    // Fail open: unavailable Blabee must never prevent normal Codex use.
    if (process.env.BLABEE_M0_DEBUG === "1") {
      process.stderr.write(`[blabee-m0] ${error.message}\n`);
    }
  }
}

main().catch((error) => {
  if (process.env.BLABEE_M0_DEBUG === "1") {
    process.stderr.write(`[blabee-m0] fatal=${error.stack ?? error.message}\n`);
  }
  process.exitCode = 0;
});

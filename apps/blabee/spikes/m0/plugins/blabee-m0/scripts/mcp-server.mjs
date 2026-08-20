#!/usr/bin/env node
import readline from "node:readline";

import { coordinatorSocketPath, requestCoordinator } from "./rpc-client.mjs";

const TOOL = {
  name: "emit_decision",
  title: "Emit Blabee decision",
  description:
    "Send one structured Blabee decision proposal for the exact active project, session, prompt episode, and turn.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: [
      "project_id",
      "session_id",
      "source_turn_id",
      "source_prompt_id",
      "episode_id",
      "correlation_token",
      "proposal",
    ],
    properties: {
      project_id: { type: "string", minLength: 1 },
      session_id: { type: "string", minLength: 1 },
      source_turn_id: { type: "string", minLength: 1 },
      source_prompt_id: { type: "string", minLength: 1 },
      episode_id: { type: "string", minLength: 1 },
      correlation_token: { type: "string", minLength: 1 },
      proposal: {
        type: "object",
        additionalProperties: true,
        required: [
          "schema_version",
          "correlation_token",
          "interaction_kind",
          "task_goal",
          "outcome",
          "recommended_next",
        ],
        properties: {
          schema_version: { const: "1.0" },
          correlation_token: { type: "string", minLength: 1 },
          interaction_kind: { const: "blabee_decision" },
          task_goal: { type: "string", minLength: 1 },
          outcome: { type: "object" },
          recommended_next: { type: "object" },
          alternative_next: { type: ["object", "null"] },
          pause_capsule: { type: "object" },
          reported_side_effects: { type: "array" },
        },
      },
    },
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
};

function reply(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id, value) {
  reply({ jsonrpc: "2.0", id, result: value });
}

function error(id, code, message) {
  reply({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handle(message) {
  if (!message || message.jsonrpc !== "2.0") return;
  if (message.method === "notifications/initialized" || message.method?.startsWith("notifications/")) {
    return;
  }
  if (message.method === "initialize") {
    result(message.id, {
      protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "blabee-m0", version: "0.1.0" },
    });
    return;
  }
  if (message.method === "ping") {
    result(message.id, {});
    return;
  }
  if (message.method === "tools/list") {
    result(message.id, { tools: [TOOL] });
    return;
  }
  if (message.method === "tools/call") {
    if (message.params?.name !== TOOL.name) {
      error(message.id, -32602, "unknown_tool");
      return;
    }
    try {
      const forwarded = await requestCoordinator({
        socketPath: coordinatorSocketPath(),
        type: "emit_decision",
        payload: message.params.arguments ?? {},
        responseTimeoutMs: 5_000,
      });
      result(message.id, {
        content: [{ type: "text", text: JSON.stringify(forwarded) }],
        structuredContent: forwarded,
      });
    } catch (requestError) {
      result(message.id, {
        isError: true,
        content: [
          {
            type: "text",
            text: `Blabee coordinator unavailable or rejected the proposal: ${requestError.message}`,
          },
        ],
      });
    }
    return;
  }
  error(message.id, -32601, "method_not_found");
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  if (!line.trim()) continue;
  try {
    await handle(JSON.parse(line));
  } catch (parseError) {
    error(null, -32700, parseError.message);
  }
}

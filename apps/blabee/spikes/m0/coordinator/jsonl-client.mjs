import net from "node:net";
import { randomUUID } from "node:crypto";

import {
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_MAX_MESSAGE_BYTES,
  DEFAULT_RESPONSE_TIMEOUT_MS,
} from "./constants.mjs";

export function requestJsonl({
  socketPath,
  type,
  payload = {},
  connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
  responseTimeoutMs = DEFAULT_RESPONSE_TIMEOUT_MS,
}) {
  if (typeof socketPath !== "string" || socketPath.length === 0) {
    return Promise.reject(new Error("socket_path_required"));
  }
  if (typeof type !== "string" || type.length === 0) {
    return Promise.reject(new Error("request_type_required"));
  }

  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    const socket = net.createConnection(socketPath);
    let buffer = "";
    let settled = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(responseTimer);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };

    const connectTimer = setTimeout(() => {
      finish(new Error("coordinator_connect_timeout"));
    }, connectTimeoutMs);

    const responseTimer = setTimeout(() => {
      finish(new Error("coordinator_response_timeout"));
    }, responseTimeoutMs);

    socket.setEncoding("utf8");
    socket.once("connect", () => {
      clearTimeout(connectTimer);
      socket.write(`${JSON.stringify({ request_id: requestId, type, payload })}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, "utf8") > DEFAULT_MAX_MESSAGE_BYTES) {
        finish(new Error("coordinator_response_too_large"));
        return;
      }

      const newline = buffer.indexOf("\n");
      if (newline === -1) return;

      let response;
      try {
        response = JSON.parse(buffer.slice(0, newline));
      } catch {
        finish(new Error("coordinator_invalid_json"));
        return;
      }

      if (response.request_id !== requestId) {
        finish(new Error("coordinator_request_id_mismatch"));
      } else if (response.ok !== true) {
        const error = new Error(response.error?.message ?? "coordinator_request_failed");
        error.code = response.error?.code;
        finish(error);
      } else {
        finish(null, response.result);
      }
    });
    socket.once("error", (error) => finish(error));
    socket.once("end", () => {
      if (!settled) finish(new Error("coordinator_closed_without_response"));
    });
  });
}

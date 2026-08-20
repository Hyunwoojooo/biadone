#!/usr/bin/env node
import { chmod, lstat, unlink } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { DEFAULT_MAX_MESSAGE_BYTES } from "./constants.mjs";
import { FakeCoordinator } from "./fake-coordinator.mjs";

function parseArgs(argv) {
  const result = { enabledProjects: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--socket") result.socketPath = argv[++index];
    else if (arg === "--enabled-project") result.enabledProjects.push(argv[++index]);
    else if (arg === "--reminder-ms") result.reminderMs = Number(argv[++index]);
    else if (arg === "--expiry-ms") result.expiryMs = Number(argv[++index]);
    else throw new Error(`unknown_argument:${arg}`);
  }
  if (!result.socketPath) throw new Error("--socket is required");
  return result;
}

async function removeStaleSocket(socketPath) {
  try {
    const info = await lstat(socketPath);
    if (!info.isSocket()) throw new Error(`socket_path_is_not_a_socket:${socketPath}`);
    await unlink(socketPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

export async function startJsonlServer({ socketPath, coordinator = new FakeCoordinator() }) {
  const resolvedSocketPath = path.resolve(socketPath);
  await removeStaleSocket(resolvedSocketPath);

  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    let handled = false;

    socket.on("data", async (chunk) => {
      if (handled) return;
      buffer += chunk;
      if (Buffer.byteLength(buffer, "utf8") > DEFAULT_MAX_MESSAGE_BYTES) {
        handled = true;
        socket.end(`${JSON.stringify({ ok: false, error: { code: "request_too_large" } })}\n`);
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      handled = true;

      let request;
      try {
        request = JSON.parse(buffer.slice(0, newline));
        const result = await coordinator.handle(request.type, request.payload ?? {});
        socket.end(`${JSON.stringify({ request_id: request.request_id, ok: true, result })}\n`);
      } catch (error) {
        socket.end(
          `${JSON.stringify({
            request_id: request?.request_id,
            ok: false,
            error: { code: error.code ?? "coordinator_error", message: error.message },
          })}\n`,
        );
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(resolvedSocketPath, resolve);
  });
  await chmod(resolvedSocketPath, 0o600);

  return {
    socketPath: resolvedSocketPath,
    coordinator,
    async close() {
      coordinator.close();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      try {
        await unlink(resolvedSocketPath);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const coordinator = new FakeCoordinator({
    reminderMs: args.reminderMs,
    expiryMs: args.expiryMs,
  });
  for (const cwd of args.enabledProjects) coordinator.enableProject({ cwd });
  const running = await startJsonlServer({ socketPath: args.socketPath, coordinator });
  process.stdout.write(`${JSON.stringify({ ready: true, socket: running.socketPath })}\n`);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await running.close();
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}

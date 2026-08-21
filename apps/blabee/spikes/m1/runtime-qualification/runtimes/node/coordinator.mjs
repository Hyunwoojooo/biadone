import {
  closeSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";

const PROTOCOL_VERSION = 1;
const BUILD_VERSION = "t005-qualification-v1";
const RUNTIME = "node";
const NOMINAL_WAIT_MS = 120_000;

function parseJournalPath(argv) {
  const argument = argv.find((value) => value.startsWith("--journal="));
  if (!argument) {
    throw new Error("--journal=<path> is required");
  }
  return resolve(argument.slice("--journal=".length));
}

function log(event, fields = {}) {
  process.stderr.write(
    `${JSON.stringify({
      schema_version: "blabee.t005.runtime-log.v1",
      event,
      runtime: RUNTIME,
      ...fields,
    })}\n`,
  );
}

function writeResponse(response) {
  process.stdout.write(
    `${JSON.stringify({
      ...response,
      runtime: RUNTIME,
      protocol_version: PROTOCOL_VERSION,
    })}\n`,
  );
}

function parseJournal(path) {
  mkdirSync(dirname(path), { recursive: true });
  const descriptor = openSync(path, "a+");
  const bytes = readFileSync(descriptor);
  const lastNewline = bytes.lastIndexOf(0x0a);
  const completeLength = lastNewline === -1 ? 0 : lastNewline + 1;
  const partialTailBytes = bytes.length - completeLength;

  if (partialTailBytes > 0) {
    ftruncateSync(descriptor, completeLength);
    fsyncSync(descriptor);
    log("journal_partial_tail_truncated", { partial_tail_bytes: partialTailBytes });
  }

  const events = [];
  if (completeLength > 0) {
    const lines = bytes.subarray(0, completeLength).toString("utf8").split("\n");
    for (let index = 0; index < lines.length - 1; index += 1) {
      const line = lines[index];
      if (line.length === 0) {
        throw new Error(`journal line ${index + 1} is empty`);
      }
      let event;
      try {
        event = JSON.parse(line);
      } catch (error) {
        throw new Error(`journal line ${index + 1} is invalid JSON: ${error.message}`);
      }
      validateEvent(event, events.length + 1);
      events.push(event);
    }
  }

  return {
    descriptor,
    events,
    partialTailBytes,
  };
}

function validateEvent(event, expectedSequence) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new Error("event must be an object");
  }
  if (typeof event.event_id !== "string" || event.event_id.length === 0) {
    throw new Error("event_id must be a non-empty string");
  }
  if (!Number.isSafeInteger(event.event_sequence) || event.event_sequence < 1) {
    throw new Error("event_sequence must be a positive safe integer");
  }
  if (event.event_sequence !== expectedSequence) {
    throw new Error(
      `event_sequence ${event.event_sequence} does not match expected ${expectedSequence}`,
    );
  }
}

function appendDurably(journal, event) {
  validateEvent(event, journal.events.length + 1);
  const bytes = Buffer.from(`${JSON.stringify(event)}\n`, "utf8");
  const offset = fstatSync(journal.descriptor).size;
  const written = writeSync(journal.descriptor, bytes, 0, bytes.length, offset);
  if (written !== bytes.length) {
    throw new Error(`short journal write: ${written}/${bytes.length}`);
  }
  fsyncSync(journal.descriptor);
  journal.events.push(event);
  log("journal_append_durable", {
    event_id: event.event_id,
    event_sequence: event.event_sequence,
  });
}

function diagnostics(journal) {
  const lastEvent = journal.events.at(-1) ?? null;
  return {
    ok: true,
    build_version: BUILD_VERSION,
    journal_event_count: journal.events.length,
    last_event_id: lastEvent?.event_id ?? null,
    last_event_sequence: lastEvent?.event_sequence ?? null,
    replayed_event_count: journal.events.length,
    partial_tail_truncated: journal.partialTailBytes > 0,
    partial_tail_bytes: journal.partialTailBytes,
    rss_bytes: process.memoryUsage().rss,
    rss_kind: "current_resident_set_bytes",
    pid: process.pid,
  };
}

async function handleRequest(request, journal) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    return { ok: false, error: "invalid_request" };
  }

  switch (request.method) {
    case "health":
      return { ok: true };
    case "append": {
      try {
        appendDurably(journal, request.event);
      } catch (error) {
        return { ok: false, error: "append_rejected", detail: error.message };
      }
      return {
        ok: true,
        durable: true,
        event_id: request.event.event_id,
        event_sequence: request.event.event_sequence,
        journal_event_count: journal.events.length,
      };
    }
    case "diagnostics":
      return diagnostics(journal);
    case "update_info":
      return {
        ok: true,
        build_version: BUILD_VERSION,
        update_strategy: "external_atomic_replacement_not_implemented",
      };
    case "wait_probe": {
      const divisor = request.scale_divisor;
      if (
        request.nominal_wait_ms !== NOMINAL_WAIT_MS ||
        !Number.isInteger(divisor) ||
        divisor < 1 ||
        divisor > NOMINAL_WAIT_MS
      ) {
        return { ok: false, error: "invalid_wait_probe" };
      }
      const scaledWaitMs = NOMINAL_WAIT_MS / divisor;
      const started = process.hrtime.bigint();
      await new Promise((resolvePromise) => setTimeout(resolvePromise, scaledWaitMs));
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      log("wait_probe_completed", {
        nominal_wait_ms: NOMINAL_WAIT_MS,
        scale_divisor: divisor,
        elapsed_monotonic_ms: elapsedMs,
      });
      return {
        ok: true,
        nominal_wait_ms: NOMINAL_WAIT_MS,
        scale_divisor: divisor,
        scaled_wait_ms: scaledWaitMs,
        elapsed_monotonic_ms: elapsedMs,
        automatic_selection: false,
      };
    }
    case "shutdown":
      return { ok: true, shutdown: true };
    default:
      return { ok: false, error: "unsupported_method" };
  }
}

async function main() {
  const journalPath = parseJournalPath(process.argv.slice(2));
  const journal = parseJournal(journalPath);
  log("runtime_started", {
    build_version: BUILD_VERSION,
    journal_event_count: journal.events.length,
  });

  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  try {
    for await (const line of input) {
      let request;
      try {
        request = JSON.parse(line);
      } catch {
        writeResponse({ ok: false, error: "invalid_json" });
        continue;
      }

      const response = await handleRequest(request, journal);
      writeResponse(response);
      if (request.method === "shutdown") {
        break;
      }
    }
  } finally {
    closeSync(journal.descriptor);
  }
}

main().catch((error) => {
  log("runtime_start_failed", { error: error.message });
  process.exitCode = 2;
});

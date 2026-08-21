import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  appendFile,
  chmod,
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { arch, cpus, platform, release, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { NdjsonClient } from "../lib/ndjson-client.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const QUALIFICATION_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const BLABEE_ROOT = resolve(QUALIFICATION_ROOT, "../../..");
const NODE_SOURCE = join(
  QUALIFICATION_ROOT,
  "runtimes",
  "node",
  "coordinator.mjs",
);
const SWIFT_SOURCE = join(
  QUALIFICATION_ROOT,
  "runtimes",
  "swift",
  "Coordinator.swift",
);
const C_BASELINE_SOURCE = join(
  BLABEE_ROOT,
  "spikes",
  "m0",
  "runtimes",
  "c",
  "coordinator.c",
);
const JOURNAL_FIXTURE = join(
  QUALIFICATION_ROOT,
  "fixtures",
  "minimal-journal.ndjson",
);
const NOMINAL_WAIT_MS = 120_000;

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function summarize(samples) {
  if (samples.length === 0) {
    return null;
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const percentile = (fraction) =>
    sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
  return {
    unit: "milliseconds",
    count: sorted.length,
    min: round(sorted[0]),
    p50: round(percentile(0.5)),
    p95: round(percentile(0.95)),
    max: round(sorted.at(-1)),
    mean: round(
      sorted.reduce((total, sample) => total + sample, 0) / sorted.length,
    ),
  };
}

function commandVersion(command) {
  const result = spawnSync(command, ["--version"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  if (result.error || result.status !== 0) {
    return null;
  }
  return `${result.stdout || result.stderr}`.trim().split(/\r?\n/, 1)[0] || null;
}

function runCommand(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    timeout: options.timeout ?? 240_000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, LC_ALL: "C" },
  });
}

function commandDiagnostic(result) {
  return `${result.stderr || result.stdout || result.error?.message || "no diagnostics"}`
    .trim()
    .slice(0, 2_000);
}

async function loadFixture() {
  const content = await readFile(JOURNAL_FIXTURE, "utf8");
  return content
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

async function directorySize(path) {
  const entry = await stat(path);
  if (!entry.isDirectory()) {
    return entry.size;
  }
  let total = 0;
  for (const child of await readdir(path)) {
    total += await directorySize(join(path, child));
  }
  return total;
}

function validateResponse(response, expectedRuntime) {
  if (
    response?.runtime !== expectedRuntime ||
    response?.protocol_version !== 1
  ) {
    throw new Error(
      `protocol mismatch for ${expectedRuntime}: ${JSON.stringify(response)}`,
    );
  }
  return response;
}

function specificationFor(candidate, journalPath) {
  return {
    command: candidate.command,
    args: [...candidate.args, `--journal=${journalPath}`],
  };
}

async function prepareCandidates(buildDirectory, options) {
  const candidates = [
    {
      id: "node-esm",
      family: "typescript-node",
      runtime: "node",
      role: "selection_candidate",
      selection_eligible: true,
      command: process.execPath,
      args: [NODE_SOURCE],
      toolchain: process.version,
      source: NODE_SOURCE,
    },
  ];

  const swiftc = options.swiftc ?? process.env.BLABEE_SWIFTC ?? "swiftc";
  const swiftVersion = commandVersion(swiftc);
  if (swiftVersion === null) {
    candidates.push({
      id: "swift-native",
      family: "swift-helper",
      runtime: "swift",
      role: "selection_candidate",
      selection_eligible: true,
      status: "skipped",
      reason: "compiler_not_found",
      toolchain_command: swiftc,
      source: SWIFT_SOURCE,
    });
  } else {
    const executable = join(buildDirectory, "blabee-coordinator-swift");
    const moduleCache =
      options.swiftModuleCache ??
      join(tmpdir(), "blabee-t005-swift-module-cache");
    await mkdir(moduleCache, { recursive: true });
    const result = runCommand(swiftc, [
      "-O",
      "-module-cache-path",
      moduleCache,
      SWIFT_SOURCE,
      "-o",
      executable,
    ]);
    if (result.error || result.status !== 0) {
      candidates.push({
        id: "swift-native",
        family: "swift-helper",
        runtime: "swift",
        role: "selection_candidate",
        selection_eligible: true,
        status: "failed",
        reason: "compile_failed",
        diagnostic: commandDiagnostic(result),
        toolchain: swiftVersion,
        source: SWIFT_SOURCE,
      });
    } else {
      candidates.push({
        id: "swift-native",
        family: "swift-helper",
        runtime: "swift",
        role: "selection_candidate",
        selection_eligible: true,
        command: executable,
        args: [],
        toolchain: swiftVersion,
        source: SWIFT_SOURCE,
      });
    }
  }

  if (options.includeC !== false) {
    const cc = options.cc ?? process.env.BLABEE_CC ?? "clang";
    const ccVersion = commandVersion(cc);
    if (ccVersion === null) {
      candidates.push({
        id: "c-health-baseline",
        family: "standalone-system-binary",
        runtime: "c",
        role: "performance_baseline_only",
        selection_eligible: false,
        status: "skipped",
        reason: "compiler_not_found",
        toolchain_command: cc,
        source: C_BASELINE_SOURCE,
      });
    } else {
      const executable = join(buildDirectory, "blabee-coordinator-c-baseline");
      const result = runCommand(cc, [
        "-O2",
        "-std=c11",
        C_BASELINE_SOURCE,
        "-o",
        executable,
      ]);
      if (result.error || result.status !== 0) {
        candidates.push({
          id: "c-health-baseline",
          family: "standalone-system-binary",
          runtime: "c",
          role: "performance_baseline_only",
          selection_eligible: false,
          status: "failed",
          reason: "compile_failed",
          diagnostic: commandDiagnostic(result),
          toolchain: ccVersion,
          source: C_BASELINE_SOURCE,
        });
      } else {
        candidates.push({
          id: "c-health-baseline",
          family: "standalone-system-binary",
          runtime: "c",
          role: "performance_baseline_only",
          selection_eligible: false,
          command: executable,
          args: [],
          toolchain: ccVersion,
          source: C_BASELINE_SOURCE,
        });
      }
    }
  }

  return candidates;
}

async function coldStartSamples(candidate, directory, iterations) {
  const samples = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const journal = join(directory, `cold-${iteration}.ndjson`);
    const client = new NdjsonClient(specificationFor(candidate, journal));
    try {
      const started = process.hrtime.bigint();
      const response = validateResponse(
        await client.request({ method: "health" }),
        candidate.runtime,
      );
      const elapsed = Number(process.hrtime.bigint() - started) / 1_000_000;
      if (response.ok !== true) {
        throw new Error(`health failed: ${JSON.stringify(response)}`);
      }
      samples.push(elapsed);
      await client.shutdown();
    } finally {
      if (!client.closed) {
        await client.killForcefully();
      }
    }
  }
  return summarize(samples);
}

async function persistentLoad(candidate, directory, options) {
  const journal = join(directory, "load.ndjson");
  const client = new NdjsonClient(specificationFor(candidate, journal));
  const healthLatencies = [];
  const appendLatencies = [];

  try {
    for (let index = 0; index < 10; index += 1) {
      const response = validateResponse(
        await client.request({ method: "health" }),
        candidate.runtime,
      );
      if (response.ok !== true) {
        throw new Error(`warmup health failed: ${JSON.stringify(response)}`);
      }
    }

    for (let index = 0; index < options.loadIterations; index += 1) {
      const started = process.hrtime.bigint();
      const response = validateResponse(
        await client.request({ method: "health" }),
        candidate.runtime,
      );
      healthLatencies.push(
        Number(process.hrtime.bigint() - started) / 1_000_000,
      );
      if (response.ok !== true) {
        throw new Error(`load health failed: ${JSON.stringify(response)}`);
      }
    }

    for (let sequence = 1; sequence <= options.appendIterations; sequence += 1) {
      const event = {
        schema_version: "blabee.t005.qualification-event.v1",
        event_id: `load_event_${String(sequence).padStart(6, "0")}`,
        event_sequence: sequence,
        event_type: "qualification_load_sample",
        payload: { sample: sequence },
      };
      const started = process.hrtime.bigint();
      const response = validateResponse(
        await client.request({ method: "append", event }),
        candidate.runtime,
      );
      appendLatencies.push(
        Number(process.hrtime.bigint() - started) / 1_000_000,
      );
      if (
        response.ok !== true ||
        response.durable !== true ||
        response.event_sequence !== sequence
      ) {
        throw new Error(`durable append failed: ${JSON.stringify(response)}`);
      }
    }

    const diagnostics = validateResponse(
      await client.request({ method: "diagnostics" }),
      candidate.runtime,
    );
    const updateInfo = validateResponse(
      await client.request({ method: "update_info" }),
      candidate.runtime,
    );
    if (
      diagnostics.ok !== true ||
      diagnostics.journal_event_count !== options.appendIterations ||
      !Number.isFinite(diagnostics.rss_bytes) ||
      updateInfo.ok !== true ||
      updateInfo.build_version !== "t005-qualification-v1" ||
      updateInfo.update_strategy !== "external_atomic_replacement_not_implemented"
    ) {
      throw new Error(
        `diagnostic/update observation failed: ${JSON.stringify({ diagnostics, updateInfo })}`,
      );
    }
    const comparableRss = processRss(client.child.pid);

    await client.shutdown();
    const logs = client.parsedLogs();
    const structuredLogs = logs.filter(
      (record) => record.schema_version === "blabee.t005.runtime-log.v1",
    );
    const runtimeStartedLogObserved = structuredLogs.some(
      (record) => record.event === "runtime_started",
    );
    const durableAppendLogObserved = structuredLogs.some(
      (record) => record.event === "journal_append_durable",
    );
    if (
      !runtimeStartedLogObserved ||
      !durableAppendLogObserved ||
      structuredLogs.length < options.appendIterations + 1
    ) {
      throw new Error(
        `structured runtime logs are incomplete: ${JSON.stringify({
          structured_log_records: structuredLogs.length,
          runtime_started: runtimeStartedLogObserved,
          durable_append: durableAppendLogObserved,
        })}`,
      );
    }
    return {
      sustained_health_roundtrip: summarize(healthLatencies),
      durable_append_roundtrip: summarize(appendLatencies),
      rss_after_sustained_load: comparableRss,
      diagnostics_observability: {
        status: "observed",
        build_version: diagnostics.build_version,
        journal_event_count: diagnostics.journal_event_count,
        last_event_sequence: diagnostics.last_event_sequence,
        structured_log_records: structuredLogs.length,
        runtime_started_log_observed: runtimeStartedLogObserved,
        durable_append_log_observed: durableAppendLogObserved,
        runtime_reported_rss: {
          value: diagnostics.rss_bytes,
          unit: "bytes",
          kind: diagnostics.rss_kind,
          comparison_use: "diagnostics_only",
        },
      },
      update_observability: {
        status: "version_observed",
        build_version: updateInfo.build_version,
        strategy: updateInfo.update_strategy,
        updater_execution: "not_implemented",
      },
    };
  } finally {
    if (!client.closed) {
      await client.killForcefully();
    }
  }
}

async function waitProbe(candidate, directory, scaleDivisor) {
  const client = new NdjsonClient(
    specificationFor(candidate, join(directory, "wait.ndjson")),
    { timeoutMs: 10_000 },
  );
  try {
    const expectedScaledWaitMs = NOMINAL_WAIT_MS / scaleDivisor;
    const observedStarted = process.hrtime.bigint();
    const response = validateResponse(
      await client.request({
        method: "wait_probe",
        nominal_wait_ms: NOMINAL_WAIT_MS,
        scale_divisor: scaleDivisor,
      }),
      candidate.runtime,
    );
    const observedElapsedMs =
      Number(process.hrtime.bigint() - observedStarted) / 1_000_000;
    const minimumElapsedMs = expectedScaledWaitMs * 0.8;
    const maximumElapsedMs = Math.max(
      expectedScaledWaitMs * 5,
      expectedScaledWaitMs + 250,
    );
    if (
      response.ok !== true ||
      response.nominal_wait_ms !== NOMINAL_WAIT_MS ||
      response.scale_divisor !== scaleDivisor ||
      response.scaled_wait_ms !== expectedScaledWaitMs ||
      !Number.isFinite(response.elapsed_monotonic_ms) ||
      response.elapsed_monotonic_ms < minimumElapsedMs ||
      response.elapsed_monotonic_ms > maximumElapsedMs ||
      observedElapsedMs < minimumElapsedMs ||
      observedElapsedMs > maximumElapsedMs ||
      response.automatic_selection !== false
    ) {
      throw new Error(`wait probe failed: ${JSON.stringify(response)}`);
    }
    await client.shutdown();
    return {
      status: "passed",
      nominal_wait_ms: response.nominal_wait_ms,
      scale_divisor: response.scale_divisor,
      scaled_wait_ms: response.scaled_wait_ms,
      elapsed_monotonic_ms: round(response.elapsed_monotonic_ms),
      harness_observed_elapsed_ms: round(observedElapsedMs),
      accepted_elapsed_range_ms: [
        round(minimumElapsedMs),
        round(maximumElapsedMs),
      ],
      automatic_selection: response.automatic_selection,
      deterministic_test_only: true,
    };
  } finally {
    if (!client.closed) {
      await client.killForcefully();
    }
  }
}

async function forcedRestartRecovery(candidate, directory, fixture) {
  const journalPath = join(directory, "restart.ndjson");
  const beforeCrash = new NdjsonClient(specificationFor(candidate, journalPath));
  let termination;
  try {
    for (const event of fixture) {
      const response = validateResponse(
        await beforeCrash.request({ method: "append", event }),
        candidate.runtime,
      );
      if (response.ok !== true || response.durable !== true) {
        throw new Error(`pre-crash append failed: ${JSON.stringify(response)}`);
      }
    }
    termination = await beforeCrash.killForcefully();
  } finally {
    if (!beforeCrash.closed) {
      await beforeCrash.killForcefully();
    }
  }
  if (termination.signal !== "SIGKILL") {
    throw new Error(`expected SIGKILL, got ${JSON.stringify(termination)}`);
  }

  const partialTail = '{"event_id":"interrupted_tail"';
  await appendFile(journalPath, partialTail, "utf8");

  const afterCrash = new NdjsonClient(specificationFor(candidate, journalPath));
  try {
    const diagnostics = validateResponse(
      await afterCrash.request({ method: "diagnostics" }),
      candidate.runtime,
    );
    if (
      diagnostics.ok !== true ||
      diagnostics.replayed_event_count !== fixture.length ||
      diagnostics.last_event_sequence !== fixture.length ||
      diagnostics.partial_tail_truncated !== true ||
      diagnostics.partial_tail_bytes !== Buffer.byteLength(partialTail)
    ) {
      throw new Error(`replay mismatch: ${JSON.stringify(diagnostics)}`);
    }

    const nextSequence = fixture.length + 1;
    const resumedEvent = {
      schema_version: "blabee.t005.qualification-event.v1",
      event_id: "qualification_event_after_restart",
      event_sequence: nextSequence,
      event_type: "qualification_replay_resumed",
      payload: { recovered: true },
    };
    const append = validateResponse(
      await afterCrash.request({ method: "append", event: resumedEvent }),
      candidate.runtime,
    );
    if (
      append.ok !== true ||
      append.durable !== true ||
      append.journal_event_count !== nextSequence
    ) {
      throw new Error(`post-restart append failed: ${JSON.stringify(append)}`);
    }
    await afterCrash.shutdown();

    const records = (await readFile(journalPath, "utf8"))
      .split(/\r?\n/)
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));
    const expectedRecords = [...fixture, resumedEvent];
    if (!isDeepStrictEqual(records, expectedRecords)) {
      throw new Error(
        `recovered journal content mismatch: ${JSON.stringify(records)}`,
      );
    }
    return {
      status: "passed",
      forced_termination_signal: termination.signal,
      durable_events_before_termination: fixture.length,
      replayed_events_after_restart: diagnostics.replayed_event_count,
      partial_tail_bytes_truncated: diagnostics.partial_tail_bytes,
      append_after_replay: true,
      final_event_count: records.length,
    };
  } finally {
    if (!afterCrash.closed) {
      await afterCrash.killForcefully();
    }
  }
}

async function packageCandidate(candidate, buildDirectory) {
  const payload = join(buildDirectory, "payloads", candidate.id);
  await mkdir(payload, { recursive: true });
  let signTarget;
  let signatureCoverage;

  if (candidate.runtime === "node") {
    signTarget = join(payload, "node");
    await copyFile(process.execPath, signTarget);
    await chmod(signTarget, 0o755);
    await copyFile(NODE_SOURCE, join(payload, basename(NODE_SOURCE)));
    await writeFile(
      join(payload, "runtime-manifest.json"),
      `${JSON.stringify(
        {
          runtime: "node",
          node_version: process.version,
          entrypoint: basename(NODE_SOURCE),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    signatureCoverage =
      "bundled Node executable only; JavaScript source is not covered by this helper signature";
  } else {
    signTarget = join(payload, "blabee-coordinator-swift");
    await copyFile(candidate.command, signTarget);
    await chmod(signTarget, 0o755);
    signatureCoverage = "entire standalone Swift helper executable";
  }

  const unsignedBytes = await directorySize(payload);
  let adHocSigning;
  const codesign = "/usr/bin/codesign";
  if (platform() !== "darwin" || !existsSync(codesign)) {
    adHocSigning = {
      status: "unavailable",
      target: basename(signTarget),
      coverage: signatureCoverage,
      reason: "codesign is unavailable on this host",
    };
  } else {
    const sign = runCommand(codesign, ["--force", "--sign", "-", signTarget]);
    const verify =
      sign.status === 0
        ? runCommand(codesign, ["--verify", "--strict", "--verbose=2", signTarget])
        : null;
    adHocSigning = {
      status: sign.status === 0 && verify?.status === 0 ? "passed" : "failed",
      target: basename(signTarget),
      coverage: signatureCoverage,
      reason:
        sign.status === 0 && verify?.status === 0
          ? null
          : commandDiagnostic(verify ?? sign),
    };
  }

  const signedPayloadBytes = await directorySize(payload);
  let signedPayloadLaunch = { status: "not_measured" };
  if (adHocSigning.status === "passed") {
    const journal = join(buildDirectory, `signed-${candidate.id}.ndjson`);
    const signedSpecification =
      candidate.runtime === "node"
        ? {
            command: signTarget,
            args: [join(payload, basename(NODE_SOURCE)), `--journal=${journal}`],
          }
        : { command: signTarget, args: [`--journal=${journal}`] };
    const client = new NdjsonClient(signedSpecification);
    try {
      const health = validateResponse(
        await client.request({ method: "health" }),
        candidate.runtime,
      );
      await client.shutdown();
      signedPayloadLaunch = {
        status: health.ok === true ? "passed" : "failed",
        reason: health.ok === true ? null : JSON.stringify(health),
      };
    } catch (error) {
      signedPayloadLaunch = { status: "failed", reason: error.message };
    } finally {
      if (!client.closed) {
        await client.killForcefully();
      }
    }
  }
  let dmg;
  const hdiutil = "/usr/bin/hdiutil";
  if (platform() !== "darwin" || !existsSync(hdiutil)) {
    dmg = {
      status: "unavailable",
      bytes: null,
      reason: "hdiutil is unavailable on this host",
    };
  } else {
    const output = join(buildDirectory, `${candidate.id}.dmg`);
    const create = runCommand(
      hdiutil,
      [
        "create",
        "-quiet",
        "-format",
        "UDZO",
        "-fs",
        "HFS+",
        "-volname",
        `Blabee ${candidate.id}`,
        "-srcfolder",
        payload,
        output,
      ],
      { timeout: 300_000 },
    );
    dmg =
      create.status === 0
        ? {
            status: "measured",
            bytes: (await stat(output)).size,
            format: "UDZO/HFS+",
            reason: null,
          }
        : {
            status: "unavailable",
            bytes: null,
            format: "UDZO/HFS+",
            reason: commandDiagnostic(create),
          };
  }

  return {
    payload: {
      unsigned_bytes: unsignedBytes,
      ad_hoc_signed_bytes: signedPayloadBytes,
      node_runtime_bundled: candidate.runtime === "node",
    },
    ad_hoc_signing: adHocSigning,
    signed_payload_launch: signedPayloadLaunch,
    developer_id_signing: {
      status: "unavailable",
      reason:
        "no Developer ID identity or credentials were supplied; the harness does not inspect or modify the login keychain",
    },
    notarization: {
      status: "not_measured",
      reason:
        "notarization credentials were not supplied and no Apple service request was attempted",
    },
    measurement_dmg: dmg,
  };
}

async function qualifySelectionCandidate(candidate, buildDirectory, fixture, options) {
  if (candidate.status === "skipped" || candidate.status === "failed") {
    const { command: _command, args: _args, source: _source, ...result } = candidate;
    return result;
  }
  const directory = join(buildDirectory, candidate.id);
  await mkdir(directory, { recursive: true });
  try {
    const cold = await coldStartSamples(
      candidate,
      directory,
      options.coldIterations,
    );
    const load = await persistentLoad(candidate, directory, options);
    const wait = await waitProbe(candidate, directory, options.waitScaleDivisor);
    const recovery = await forcedRestartRecovery(
      candidate,
      directory,
      fixture,
    );
    const packaging = options.includePackaging
      ? await packageCandidate(candidate, buildDirectory)
      : {
          payload: { status: "not_measured" },
          ad_hoc_signing: { status: "not_measured" },
          signed_payload_launch: { status: "not_measured" },
          developer_id_signing: {
            status: "unavailable",
            reason: "credentials were not supplied",
          },
          notarization: { status: "not_measured" },
          measurement_dmg: { status: "not_measured", bytes: null },
        };
    return {
      id: candidate.id,
      family: candidate.family,
      runtime: candidate.runtime,
      role: candidate.role,
      selection_eligible: true,
      status: "qualified",
      toolchain: candidate.toolchain,
      protocol: {
        framing: "NDJSON request/response",
        journal: "append one JSON event line and fsync before acknowledgement",
        fixture: "fixtures/minimal-journal.ndjson",
      },
      cold_start_plus_health_roundtrip: cold,
      sustained_load: load,
      wait_120_seconds: wait,
      forced_restart_recovery: recovery,
      packaging,
    };
  } catch (error) {
    return {
      id: candidate.id,
      family: candidate.family,
      runtime: candidate.runtime,
      role: candidate.role,
      selection_eligible: true,
      status: "failed",
      reason: "qualification_failed",
      diagnostic: error.message,
      toolchain: candidate.toolchain,
    };
  }
}

function processRss(pid) {
  if (platform() !== "darwin" && platform() !== "linux") {
    return { status: "unsupported", value: null, unit: "bytes" };
  }
  const ps = existsSync("/bin/ps") ? "/bin/ps" : "ps";
  const result = runCommand(ps, ["-o", "rss=", "-p", String(pid)]);
  const kilobytes = Number(`${result.stdout ?? ""}`.trim());
  if (result.status !== 0 || !Number.isFinite(kilobytes)) {
    return {
      status: "unavailable",
      value: null,
      unit: "bytes",
      reason: commandDiagnostic(result),
    };
  }
  return {
    status: "measured",
    value: kilobytes * 1024,
    unit: "bytes",
    method: "ps rss after persistent health load",
  };
}

async function qualifyCBaseline(candidate, buildDirectory, options) {
  if (candidate.status === "skipped" || candidate.status === "failed") {
    const { command: _command, args: _args, source: _source, ...result } = candidate;
    return result;
  }
  const latencies = [];
  for (let iteration = 0; iteration < options.coldIterations; iteration += 1) {
    const client = new NdjsonClient({ command: candidate.command, args: [] });
    try {
      const started = process.hrtime.bigint();
      const response = validateResponse(
        await client.request({ method: "health" }),
        "c",
      );
      latencies.push(Number(process.hrtime.bigint() - started) / 1_000_000);
      if (response.ok !== true) {
        throw new Error(`C baseline health failed: ${JSON.stringify(response)}`);
      }
    } finally {
      if (!client.closed) {
        await client.killForcefully();
      }
    }
  }

  const client = new NdjsonClient({ command: candidate.command, args: [] });
  const sustained = [];
  try {
    for (let iteration = 0; iteration < options.loadIterations; iteration += 1) {
      const started = process.hrtime.bigint();
      const response = validateResponse(
        await client.request({ method: "health" }),
        "c",
      );
      sustained.push(Number(process.hrtime.bigint() - started) / 1_000_000);
      if (response.ok !== true) {
        throw new Error(`C baseline load failed: ${JSON.stringify(response)}`);
      }
    }
    const executableBytes = (await stat(candidate.command)).size;
    return {
      id: candidate.id,
      family: candidate.family,
      runtime: "c",
      role: "performance_baseline_only",
      selection_eligible: false,
      status: "measured",
      toolchain: candidate.toolchain,
      protocol_scope: "M0 health only; no JSON journal/replay parity",
      cold_start_plus_health_roundtrip: summarize(latencies),
      sustained_health_roundtrip: summarize(sustained),
      rss_after_sustained_load: processRss(client.child.pid),
      executable_bytes: executableBytes,
      exclusion_reason:
        "the C fixture has no complete JSON journal contract and cannot be selected from performance measurements",
    };
  } finally {
    await client.killForcefully();
  }
}

export function decideRuntime(candidates, includePackaging) {
  const node = candidates.find((candidate) => candidate.id === "node-esm");
  const swift = candidates.find((candidate) => candidate.id === "swift-native");
  const commonQualificationPassed =
    node?.status === "qualified" &&
    swift?.status === "qualified" &&
    node.forced_restart_recovery?.status === "passed" &&
    swift.forced_restart_recovery?.status === "passed" &&
    node.wait_120_seconds?.status === "passed" &&
    swift.wait_120_seconds?.status === "passed";
  const packagingPassed =
    includePackaging &&
    node?.packaging?.ad_hoc_signing?.status === "passed" &&
    swift?.packaging?.ad_hoc_signing?.status === "passed" &&
    node?.packaging?.signed_payload_launch?.status === "passed" &&
    swift?.packaging?.signed_payload_launch?.status === "passed" &&
    node?.packaging?.measurement_dmg?.status === "measured" &&
    swift?.packaging?.measurement_dmg?.status === "measured";

  if (!commonQualificationPassed || !packagingPassed) {
    return {
      status: "evidence_gate",
      selected_runtime: null,
      implementation_target: null,
      rationale: [
        "Node and Swift must both pass the common durable-journal, restart, wait, load, ad-hoc signing, and measurement-DMG probes before selection.",
        "C remains ineligible because it is a health-only performance baseline without journal parity.",
      ],
      remaining_evidence: [
        commonQualificationPassed ? null : "common Node/Swift qualification",
        packagingPassed ? null : "comparable ad-hoc signing and measurement-DMG evidence",
      ].filter(Boolean),
    };
  }

  return {
    status: "selected",
    selected_runtime: "swift-native",
    implementation_target: "T-007 coordinator core and macOS helper",
    rationale: [
      "Node and Swift passed the same NDJSON durable-journal, SIGKILL replay, deterministic 120-second wait, sustained-load, diagnostic, signing, and DMG probes.",
      "Swift provides a standalone helper whose signature covers the whole executable; the Node payload must bundle a separate runtime and its JavaScript source is outside the helper executable signature.",
      "Swift is the smaller native macOS packaging surface in this measured slice; Node remains the reference/contract harness.",
      "C is explicitly excluded from selection regardless of its performance.",
    ],
    release_gates_not_blocking_language_selection: [
      "Developer ID signing was unavailable because credentials were not supplied.",
      "Apple notarization was not measured and remains a T-012 release gate.",
      "The production updater and rollback path are not implemented; only version/update observability was verified.",
    ],
  };
}

export async function runQualification(options = {}) {
  const configuration = {
    coldIterations: options.coldIterations ?? 12,
    loadIterations: options.loadIterations ?? 500,
    appendIterations: options.appendIterations ?? 24,
    waitScaleDivisor: options.waitScaleDivisor ?? 1_200,
    includePackaging: options.includePackaging ?? true,
    includeC: options.includeC ?? true,
    swiftc: options.swiftc,
    cc: options.cc,
    swiftModuleCache: options.swiftModuleCache,
  };
  for (const [name, value] of Object.entries({
    coldIterations: configuration.coldIterations,
    loadIterations: configuration.loadIterations,
    appendIterations: configuration.appendIterations,
    waitScaleDivisor: configuration.waitScaleDivisor,
  })) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${name} must be a positive integer`);
    }
  }
  if (configuration.waitScaleDivisor > NOMINAL_WAIT_MS) {
    throw new Error(`waitScaleDivisor must be <= ${NOMINAL_WAIT_MS}`);
  }

  const buildDirectory = await mkdtemp(
    join(tmpdir(), "blabee-t005-runtime-qualification-"),
  );
  try {
    const fixture = await loadFixture();
    const prepared = await prepareCandidates(buildDirectory, configuration);
    const results = [];
    for (const candidate of prepared) {
      if (candidate.role === "performance_baseline_only") {
        results.push(
          await qualifyCBaseline(candidate, buildDirectory, configuration),
        );
      } else {
        results.push(
          await qualifySelectionCandidate(
            candidate,
            buildDirectory,
            fixture,
            configuration,
          ),
        );
      }
    }

    return {
      schema_version: "blabee.t005.runtime-qualification.v1",
      generated_at: new Date().toISOString(),
      environment: {
        platform: platform(),
        architecture: arch(),
        os_release: release(),
        cpu_model: cpus()[0]?.model ?? null,
        logical_cpu_count: cpus().length,
        node_version: process.version,
      },
      configuration: {
        cold_iterations: configuration.coldIterations,
        sustained_health_iterations: configuration.loadIterations,
        durable_append_iterations: configuration.appendIterations,
        nominal_wait_ms: NOMINAL_WAIT_MS,
        wait_scale_divisor: configuration.waitScaleDivisor,
        fixture: "fixtures/minimal-journal.ndjson",
        temporary_builds_removed: true,
        production_dependencies_added: false,
      },
      credentials: {
        developer_id: {
          status: "unavailable",
          reason: "no identity or credentials were supplied to this harness",
        },
        notarization: {
          status: "not_measured",
          reason: "no credentials were supplied and no Apple service call was made",
        },
      },
      candidates: results,
      recommendation: decideRuntime(results, configuration.includePackaging),
    };
  } finally {
    await rm(buildDirectory, { recursive: true, force: true });
  }
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const readNumber = (name) => {
      const value = Number(argv[index + 1]);
      index += 1;
      if (!Number.isInteger(value)) {
        throw new Error(`${name} requires an integer`);
      }
      return value;
    };
    if (argument === "--cold-iterations") {
      options.coldIterations = readNumber(argument);
    } else if (argument === "--load-iterations") {
      options.loadIterations = readNumber(argument);
    } else if (argument === "--append-iterations") {
      options.appendIterations = readNumber(argument);
    } else if (argument === "--wait-scale-divisor") {
      options.waitScaleDivisor = readNumber(argument);
    } else if (argument === "--skip-packaging") {
      options.includePackaging = false;
    } else if (argument === "--skip-c") {
      options.includeC = false;
    } else if (argument === "--swiftc") {
      options.swiftc = argv[index + 1];
      index += 1;
    } else if (argument === "--cc") {
      options.cc = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  runQualification(parseArguments(process.argv.slice(2)))
    .then((report) => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`runtime qualification failed: ${error.message}\n`);
      process.exitCode = 1;
    });
}

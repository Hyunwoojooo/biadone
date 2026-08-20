import { spawn, spawnSync } from "node:child_process";
import {
  mkdtemp,
  rm,
  stat,
} from "node:fs/promises";
import { cpus, arch, platform, release, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const M0_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const DEFAULT_REQUEST = Object.freeze({ method: "health" });

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function commandVersion(command) {
  const result = spawnSync(command, ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
  });

  if (result.error || result.status !== 0) {
    return null;
  }

  return `${result.stdout || result.stderr}`.trim().split(/\r?\n/, 1)[0] || null;
}

async function fileSize(path) {
  return (await stat(path)).size;
}

function compile(command, args) {
  return spawnSync(command, args, {
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

function compileFailure(result) {
  return `${result.stderr || result.stdout || "compiler exited without diagnostics"}`
    .trim()
    .slice(0, 2_000);
}

async function prepareCandidates(buildDirectory, compilerCommands) {
  const nodeSource = join(M0_ROOT, "runtimes", "node", "coordinator.mjs");
  const swiftSource = join(M0_ROOT, "runtimes", "swift", "Coordinator.swift");
  const cSource = join(M0_ROOT, "runtimes", "c", "coordinator.c");
  const candidates = [
    {
      id: "node-esm",
      family: "typescript-node",
      runtime: "node",
      status: "ready",
      command: process.execPath,
      args: [nodeSource],
      toolchain: process.version,
      distribution: {
        source_bytes: await fileSize(nodeSource),
        executable_bytes: null,
        measured_deployment_bytes: await fileSize(nodeSource),
        external_runtime_required: true,
        basis: "ESM source only; the Node runtime is not bundled",
      },
    },
  ];

  const swiftc = compilerCommands.swiftc;
  const swiftVersion = commandVersion(swiftc);
  if (swiftVersion === null) {
    candidates.push({
      id: "swift-native",
      family: "swift-helper",
      runtime: "swift",
      status: "skipped",
      reason: "compiler_not_found",
      toolchain_command: swiftc,
      distribution: {
        source_bytes: await fileSize(swiftSource),
        executable_bytes: null,
        measured_deployment_bytes: null,
        external_runtime_required: false,
        basis: "not compiled",
      },
    });
  } else {
    const executable = join(buildDirectory, "blabee-coordinator-swift");
    const result = compile(swiftc, [
      "-O",
      "-module-cache-path",
      join(buildDirectory, "swift-module-cache"),
      swiftSource,
      "-o",
      executable,
    ]);

    if (result.error || result.status !== 0) {
      candidates.push({
        id: "swift-native",
        family: "swift-helper",
        runtime: "swift",
        status: "failed",
        reason: "compile_failed",
        diagnostic: compileFailure(result),
        toolchain: swiftVersion,
        distribution: {
          source_bytes: await fileSize(swiftSource),
          executable_bytes: null,
          measured_deployment_bytes: null,
          external_runtime_required: false,
          basis: "compile failed",
        },
      });
    } else {
      const executableBytes = await fileSize(executable);
      candidates.push({
        id: "swift-native",
        family: "swift-helper",
        runtime: "swift",
        status: "ready",
        command: executable,
        args: [],
        toolchain: swiftVersion,
        distribution: {
          source_bytes: await fileSize(swiftSource),
          executable_bytes: executableBytes,
          measured_deployment_bytes: executableBytes,
          external_runtime_required: false,
          basis: "optimized executable from swiftc -O",
        },
      });
    }
  }

  const cc = compilerCommands.cc;
  const ccVersion = commandVersion(cc);
  if (ccVersion === null) {
    candidates.push({
      id: "c-system",
      family: "standalone-system-binary",
      runtime: "c",
      status: "skipped",
      reason: "compiler_not_found",
      toolchain_command: cc,
      distribution: {
        source_bytes: await fileSize(cSource),
        executable_bytes: null,
        measured_deployment_bytes: null,
        external_runtime_required: false,
        basis: "not compiled",
      },
    });
  } else {
    const executable = join(buildDirectory, "blabee-coordinator-c");
    const result = compile(cc, ["-O2", "-std=c11", cSource, "-o", executable]);

    if (result.error || result.status !== 0) {
      candidates.push({
        id: "c-system",
        family: "standalone-system-binary",
        runtime: "c",
        status: "failed",
        reason: "compile_failed",
        diagnostic: compileFailure(result),
        toolchain: ccVersion,
        distribution: {
          source_bytes: await fileSize(cSource),
          executable_bytes: null,
          measured_deployment_bytes: null,
          external_runtime_required: false,
          basis: "compile failed",
        },
      });
    } else {
      const executableBytes = await fileSize(executable);
      candidates.push({
        id: "c-system",
        family: "standalone-system-binary",
        runtime: "c",
        status: "ready",
        command: executable,
        args: [],
        toolchain: ccVersion,
        distribution: {
          source_bytes: await fileSize(cSource),
          executable_bytes: executableBytes,
          measured_deployment_bytes: executableBytes,
          external_runtime_required: false,
          basis: "optimized executable from C source; system libc remains dynamic",
        },
      });
    }
  }

  return candidates;
}

function runHealthRoundTrip(command, args, request, timeoutMs = 5_000) {
  return new Promise((resolvePromise, rejectPromise) => {
    const started = process.hrtime.bigint();
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let response = null;
    let latencyMs = null;
    let settled = false;

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`health roundtrip exceeded ${timeoutMs} ms`));
    }, timeoutMs);

    function finish(error, result) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (error) {
        rejectPromise(error);
      } else {
        resolvePromise(result);
      }
    }

    child.on("error", (error) => finish(error));
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (response !== null) {
        return;
      }

      const newline = stdout.indexOf("\n");
      if (newline === -1) {
        return;
      }

      try {
        response = JSON.parse(stdout.slice(0, newline));
        latencyMs = Number(process.hrtime.bigint() - started) / 1_000_000;
        child.stdin.end();
      } catch (error) {
        child.kill("SIGKILL");
        finish(new Error(`invalid JSON response: ${error.message}`));
      }
    });
    child.on("close", (code, signal) => {
      if (response === null) {
        finish(
          new Error(
            `process exited before a response (code=${code}, signal=${signal}, stderr=${stderr.trim()})`,
          ),
        );
        return;
      }

      if (code !== 0) {
        finish(new Error(`process exited with code ${code}: ${stderr.trim()}`));
        return;
      }

      finish(null, { response, latency_ms: latencyMs, stderr });
    });

    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE") {
        finish(error);
      }
    });
    child.stdin.write(`${JSON.stringify(request)}\n`);
  });
}

function validateHealthResponse(response, expectedRuntime) {
  if (
    response?.ok !== true ||
    response?.runtime !== expectedRuntime ||
    response?.protocol_version !== 1
  ) {
    throw new Error(
      `protocol mismatch for ${expectedRuntime}: ${JSON.stringify(response)}`,
    );
  }
}

function summarize(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  const percentile = (fraction) =>
    sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
  const mean = sorted.reduce((sum, sample) => sum + sample, 0) / sorted.length;

  return {
    unit: "milliseconds",
    count: sorted.length,
    min: round(sorted[0]),
    p50: round(percentile(0.5)),
    p95: round(percentile(0.95)),
    max: round(sorted.at(-1)),
    mean: round(mean),
    samples: sorted.map((sample) => round(sample)),
  };
}

async function measurePeakRss(candidate, request) {
  if (platform() !== "darwin" && platform() !== "linux") {
    return {
      status: "unsupported",
      value: null,
      unit: "bytes",
      method: null,
      reason: "peak RSS parser is implemented only for macOS and Linux",
    };
  }

  try {
    await stat("/usr/bin/time");
  } catch {
    return {
      status: "unsupported",
      value: null,
      unit: "bytes",
      method: null,
      reason: "/usr/bin/time is unavailable",
    };
  }

  const timeArgs = platform() === "darwin" ? ["-l"] : ["-v"];
  let sample;
  try {
    sample = await runHealthRoundTrip(
      "/usr/bin/time",
      [...timeArgs, candidate.command, ...candidate.args],
      request,
    );
    validateHealthResponse(sample.response, candidate.runtime);
  } catch (error) {
    return {
      status: "unsupported",
      value: null,
      unit: "bytes",
      method: `/usr/bin/time ${timeArgs.join(" ")}`,
      reason: `peak RSS probe failed without invalidating the protocol benchmark: ${error.message}`,
    };
  }

  const match =
    platform() === "darwin"
      ? sample.stderr.match(/([0-9]+)\s+maximum resident set size/i)
      : sample.stderr.match(/Maximum resident set size \(kbytes\):\s*([0-9]+)/i);

  if (match === null) {
    return {
      status: "unsupported",
      value: null,
      unit: "bytes",
      method: `/usr/bin/time ${timeArgs.join(" ")}`,
      reason: "the operating-system output did not contain a recognized peak RSS field",
    };
  }

  const multiplier = platform() === "darwin" ? 1 : 1024;
  return {
    status: "measured",
    value: Number(match[1]) * multiplier,
    unit: "bytes",
    method: `/usr/bin/time ${timeArgs.join(" ")} (one separate health sample)`,
    reason: null,
  };
}

function sanitizeCandidate(candidate) {
  const { command: _command, args: _args, ...serializable } = candidate;
  return serializable;
}

export async function runBenchmark(options = {}) {
  const iterations = options.iterations ?? 12;
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 500) {
    throw new Error("iterations must be an integer between 1 and 500");
  }

  const request = options.request ?? DEFAULT_REQUEST;
  const measureRss = options.measureRss ?? true;
  const compilerCommands = {
    swiftc:
      options.compilerCommands?.swiftc ??
      process.env.BLABEE_SWIFTC ??
      "swiftc",
    cc: options.compilerCommands?.cc ?? process.env.BLABEE_CC ?? "clang",
  };
  const buildDirectory = await mkdtemp(join(tmpdir(), "blabee-m0-runtimes-"));

  try {
    const prepared = await prepareCandidates(buildDirectory, compilerCommands);
    const results = [];

    for (const candidate of prepared) {
      if (candidate.status !== "ready") {
        results.push(sanitizeCandidate(candidate));
        continue;
      }

      try {
        const latencySamples = [];
        let sampleResponse = null;
        for (let iteration = 0; iteration < iterations; iteration += 1) {
          const sample = await runHealthRoundTrip(
            candidate.command,
            candidate.args,
            request,
          );
          validateHealthResponse(sample.response, candidate.runtime);
          sampleResponse = sample.response;
          latencySamples.push(sample.latency_ms);
        }

        const peakRss = measureRss
          ? await measurePeakRss(candidate, request)
          : {
              status: "not_requested",
              value: null,
              unit: "bytes",
              method: null,
              reason: "disabled by benchmark option",
            };

        results.push({
          ...sanitizeCandidate(candidate),
          status: "measured",
          protocol: {
            request,
            sample_response: sampleResponse,
            validated_samples: iterations,
          },
          cold_start_plus_health_roundtrip: summarize(latencySamples),
          peak_rss: peakRss,
          restart_recovery: {
            status: "not_measured",
            reason: "the health-only candidate has no durable state to recover",
          },
          signing_and_notarization: {
            status: "not_measured",
            reason: "requires a signed app/DMG packaging fixture",
          },
        });
      } catch (error) {
        results.push({
          ...sanitizeCandidate(candidate),
          status: "failed",
          reason: "measurement_failed",
          diagnostic: error.message,
        });
      }
    }

    return {
      schema_version: "blabee.m0.runtime-benchmark.v1",
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
        iterations,
        request,
        latency_definition:
          "fresh process spawn until the first complete NDJSON health response",
        peak_rss_is_separate_sample: true,
        temporary_builds_removed: true,
      },
      candidates: results,
      recommendation: {
        status: "evidence_gate",
        selected_runtime: null,
        next_validation_candidate: "swift-native",
        rationale: [
          "This spike measures protocol viability, cold latency, artifact size, and peak RSS only.",
          "Swift remains the first packaging candidate because the public product is a native macOS app, not because this microbenchmark proves its operational superiority.",
        ],
        remaining_evidence: [
          "idle and sustained-load memory",
          "crash and durable-state restart recovery",
          "Developer ID signing, notarization, DMG size, and update flow",
          "diagnostics and maintenance cost for the full coordinator contract",
        ],
      },
    };
  } finally {
    await rm(buildDirectory, { recursive: true, force: true });
  }
}

function parseCliArguments(argv) {
  let iterations = 12;
  let measureRss = true;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--skip-rss") {
      measureRss = false;
    } else if (argument === "--iterations") {
      iterations = Number(argv[index + 1]);
      index += 1;
    } else if (argument.startsWith("--iterations=")) {
      iterations = Number(argument.slice("--iterations=".length));
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }

  return { iterations, measureRss };
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  runBenchmark(parseCliArguments(process.argv.slice(2)))
    .then((report) => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`runtime benchmark failed: ${error.message}\n`);
      process.exitCode = 1;
    });
}

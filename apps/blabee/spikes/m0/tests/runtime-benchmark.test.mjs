import assert from "node:assert/strict";
import test from "node:test";

import { runBenchmark } from "../scripts/benchmark-runtimes.mjs";

test("all available runtimes satisfy the health protocol and measurement schema", async () => {
  const report = await runBenchmark({ iterations: 2, measureRss: false });

  assert.equal(report.schema_version, "blabee.m0.runtime-benchmark.v1");
  assert.equal(report.configuration.iterations, 2);
  assert.equal(report.configuration.temporary_builds_removed, true);
  assert.equal(report.candidates.length, 3);

  const measured = report.candidates.filter(
    (candidate) => candidate.status === "measured",
  );
  assert.ok(measured.some((candidate) => candidate.id === "node-esm"));

  for (const candidate of measured) {
    assert.deepEqual(candidate.protocol.request, { method: "health" });
    assert.deepEqual(candidate.protocol.sample_response, {
      ok: true,
      runtime: candidate.runtime,
      protocol_version: 1,
    });
    assert.equal(candidate.protocol.validated_samples, 2);
    assert.equal(candidate.cold_start_plus_health_roundtrip.count, 2);
    assert.equal(
      candidate.cold_start_plus_health_roundtrip.samples.length,
      2,
    );
    assert.ok(candidate.cold_start_plus_health_roundtrip.min > 0);
    assert.ok(candidate.distribution.source_bytes > 0);
  }

  for (const candidate of report.candidates) {
    assert.ok(["measured", "skipped", "failed"].includes(candidate.status));
    assert.notEqual(
      candidate.status,
      "failed",
      `${candidate.id} failed: ${candidate.diagnostic ?? candidate.reason}`,
    );
    if (candidate.status === "skipped") {
      assert.equal(candidate.reason, "compiler_not_found");
    }
  }
});

test("missing Swift and C compilers are reported as graceful skips", async () => {
  const report = await runBenchmark({
    iterations: 1,
    measureRss: false,
    compilerCommands: {
      swiftc: "blabee-intentionally-missing-swiftc",
      cc: "blabee-intentionally-missing-cc",
    },
  });

  const node = report.candidates.find((candidate) => candidate.id === "node-esm");
  const swift = report.candidates.find(
    (candidate) => candidate.id === "swift-native",
  );
  const c = report.candidates.find((candidate) => candidate.id === "c-system");

  assert.equal(node.status, "measured");
  assert.equal(swift.status, "skipped");
  assert.equal(swift.reason, "compiler_not_found");
  assert.equal(c.status, "skipped");
  assert.equal(c.reason, "compiler_not_found");
  assert.equal(report.recommendation.status, "evidence_gate");
});

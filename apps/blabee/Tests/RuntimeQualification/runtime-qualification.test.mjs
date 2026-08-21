import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { NdjsonClient } from "../../spikes/m1/runtime-qualification/lib/ndjson-client.mjs";
import {
  decideRuntime,
  runQualification,
} from "../../spikes/m1/runtime-qualification/scripts/qualify-runtimes.mjs";

test(
  "Node and Swift pass the same durable journal, restart, wait, load, and observability probes",
  { timeout: 240_000 },
  async () => {
    const report = await runQualification({
      coldIterations: 1,
      loadIterations: 8,
      appendIterations: 3,
      waitScaleDivisor: 12_000,
      includePackaging: false,
      includeC: true,
    });

    assert.equal(report.schema_version, "blabee.t005.runtime-qualification.v1");
    assert.equal(report.configuration.nominal_wait_ms, 120_000);
    assert.equal(report.configuration.production_dependencies_added, false);
    assert.equal(report.credentials.developer_id.status, "unavailable");
    assert.equal(report.credentials.notarization.status, "not_measured");

    const candidates = ["node-esm", "swift-native"].map((id) => {
      const candidate = report.candidates.find((entry) => entry.id === id);
      assert.ok(candidate, `missing ${id}`);
      return candidate;
    });
    for (const candidate of candidates) {
      assert.equal(candidate.status, "qualified", candidate.diagnostic);
      assert.equal(candidate.selection_eligible, true);
      assert.equal(candidate.protocol.framing, "NDJSON request/response");
      assert.equal(
        candidate.protocol.journal,
        "append one JSON event line and fsync before acknowledgement",
      );
      assert.equal(candidate.forced_restart_recovery.status, "passed");
      assert.equal(
        candidate.forced_restart_recovery.forced_termination_signal,
        "SIGKILL",
      );
      assert.equal(candidate.forced_restart_recovery.replayed_events_after_restart, 4);
      assert.equal(candidate.forced_restart_recovery.append_after_replay, true);
      assert.equal(candidate.wait_120_seconds.status, "passed");
      assert.equal(candidate.wait_120_seconds.nominal_wait_ms, 120_000);
      assert.equal(candidate.wait_120_seconds.automatic_selection, false);
      assert.ok(candidate.wait_120_seconds.elapsed_monotonic_ms >= 8);
      assert.ok(candidate.wait_120_seconds.harness_observed_elapsed_ms >= 8);
      assert.equal(
        candidate.sustained_load.diagnostics_observability
          .runtime_started_log_observed,
        true,
      );
      assert.equal(
        candidate.sustained_load.diagnostics_observability
          .durable_append_log_observed,
        true,
      );
      assert.equal(
        candidate.sustained_load.update_observability.updater_execution,
        "not_implemented",
      );
      assert.ok(
        ["measured", "unavailable", "unsupported"].includes(
          candidate.sustained_load.rss_after_sustained_load.status,
        ),
      );
      if (candidate.sustained_load.rss_after_sustained_load.status === "measured") {
        assert.ok(candidate.sustained_load.rss_after_sustained_load.value > 0);
      }
      assert.ok(
        candidate.sustained_load.diagnostics_observability
          .runtime_reported_rss.value > 0,
      );
      assert.equal(
        candidate.sustained_load.diagnostics_observability
          .runtime_reported_rss.comparison_use,
        "diagnostics_only",
      );
    }

    const c = report.candidates.find(
      (candidate) => candidate.id === "c-health-baseline",
    );
    assert.ok(c);
    assert.equal(c.role, "performance_baseline_only");
    assert.equal(c.selection_eligible, false);
    assert.match(c.protocol_scope, /no JSON journal\/replay parity/);

    assert.equal(report.recommendation.status, "evidence_gate");
    assert.equal(report.recommendation.selected_runtime, null);
    assert.deepEqual(report.recommendation.remaining_evidence, [
      "comparable ad-hoc signing and measurement-DMG evidence",
    ]);
  },
);

test("runtime selection can choose Swift only after both candidates pass packaging", () => {
  const common = (id) => ({
    id,
    status: "qualified",
    forced_restart_recovery: { status: "passed" },
    wait_120_seconds: { status: "passed" },
    packaging: {
      ad_hoc_signing: { status: "passed" },
      signed_payload_launch: { status: "passed" },
      measurement_dmg: { status: "measured" },
    },
  });
  const candidates = [
    common("node-esm"),
    common("swift-native"),
    {
      id: "c-health-baseline",
      status: "measured",
      selection_eligible: false,
    },
  ];

  const decision = decideRuntime(candidates, true);
  assert.equal(decision.status, "selected");
  assert.equal(decision.selected_runtime, "swift-native");
  assert.ok(decision.rationale.some((line) => line.includes("C is explicitly excluded")));

  candidates[0].packaging.measurement_dmg.status = "unavailable";
  const gated = decideRuntime(candidates, true);
  assert.equal(gated.status, "evidence_gate");
  assert.equal(gated.selected_runtime, null);
});

test("invalid qualification scales fail before any runtime is built", async () => {
  await assert.rejects(
    runQualification({ waitScaleDivisor: 120_001 }),
    /waitScaleDivisor must be <= 120000/,
  );
  await assert.rejects(
    runQualification({ appendIterations: 0 }),
    /appendIterations must be a positive integer/,
  );
});

test("a timed-out request kills the runtime and rejects queued requests without FIFO desync", async () => {
  const directory = await mkdtemp(join(tmpdir(), "blabee-t005-timeout-"));
  const runtime = resolve(
    "spikes/m1/runtime-qualification/runtimes/node/coordinator.mjs",
  );
  const client = new NdjsonClient({
    command: process.execPath,
    args: [runtime, `--journal=${join(directory, "journal.ndjson")}`],
  });
  try {
    const waiting = client.request(
      {
        method: "wait_probe",
        nominal_wait_ms: 120_000,
        scale_divisor: 1_200,
      },
      5,
    );
    const queued = client.request({ method: "health" });
    const results = await Promise.allSettled([waiting, queued]);

    assert.equal(results[0].status, "rejected");
    assert.match(results[0].reason.message, /exceeded 5 ms/);
    assert.equal(results[1].status, "rejected");
    assert.match(results[1].reason.message, /runtime exited/);
    const termination = await client.exit;
    assert.equal(termination.signal, "SIGKILL");
  } finally {
    if (!client.closed) {
      await client.killForcefully();
    }
    await rm(directory, { recursive: true, force: true });
  }
});

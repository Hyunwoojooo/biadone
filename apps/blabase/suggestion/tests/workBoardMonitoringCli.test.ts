import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  codexLocalDirectory,
  writeStoredCodexConfig
} from "../src/connectors/codex/localStore";
import {
  createWorkBoardMonitoringReceipt,
  recordWorkBoardMonitoringMutation
} from "../src/suggestionBoard/monitoring";
import {
  runWorkBoardMonitoringCli
} from "../tools/run-work-board-monitoring";
import {
  MONITORING_NOW,
  MONITORING_SECRET,
  monitoringAuthority
} from "./fixtures/workBoardMonitoringFixture";

const roots: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })
    )
  );
});

describe("Work Board monitoring CLI", () => {
  it("prints only the bounded aggregate and leaves private state byte-identical", async () => {
    const cwd = await prepareMonitoringRoot();
    const staleTemp = join(
      codexLocalDirectory(cwd),
      "config.json.123.aaaaaaaaaaaaaaaa.tmp"
    );
    await writeFile(staleTemp, "stale", { mode: 0o600 });
    await utimes(staleTemp, new Date(0), new Date(0));
    const before = await filesystemSnapshot(cwd);

    const result = await runWorkBoardMonitoringCli(["aggregate"], {
      cwd,
      now: new Date("2026-08-13T09:02:00.000Z")
    });

    expect(result.exitCode).toBe(0);
    expect(Buffer.byteLength(result.stdout, "utf8")).toBeLessThanOrEqual(
      64 * 1024
    );
    expect(result.stdout.endsWith("\n")).toBe(true);
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual([
      "aggregate",
      "command",
      "contract",
      "scope",
      "status"
    ]);
    expect(parsed).toMatchObject({
      contract: "work-board-monitoring-cli-v0.1",
      command: "aggregate",
      scope: "stored_quality_aggregate_only",
      status: "ready",
      aggregate: {
        eventCount: 3,
        eligibleDistinct: 2,
        ratedDistinct: 1,
        usefulDistinct: 1,
        appliedToRanking: false,
        goldEligible: false,
        releaseGateEligible: false
      }
    });
    expect(await filesystemSnapshot(cwd)).toEqual(before);
    expectPrivateValuesAbsent(result.stdout, cwd);
  });

  it("replays only the authenticated stored quality aggregate", async () => {
    const cwd = await prepareMonitoringRoot();
    const result = await runWorkBoardMonitoringCli(["replay"], { cwd });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual([
      "command",
      "contract",
      "replay",
      "scope",
      "status"
    ]);
    expect(parsed).toMatchObject({
      contract: "work-board-monitoring-cli-v0.1",
      command: "replay",
      scope: "stored_quality_aggregate_only",
      status: "matched",
      replay: {
        status: "matched",
        inputEventCount: 3,
        mismatchCodes: [],
        aggregate: {
          appliedToRanking: false,
          goldEligible: false,
          releaseGateEligible: false
        }
      }
    });
    expectPrivateValuesAbsent(result.stdout, cwd);

    const source = await readFile(
      join(process.cwd(), "tools", "run-work-board-monitoring.ts"),
      "utf8"
    );
    for (const productionEngineToken of [
      "liveShadow",
      "evaluateLive",
      "composeWorkSuggestionBoard",
      "createSharedLocalEnvSnapshot"
    ]) {
      expect(source).not.toContain(productionEngineToken);
    }
  });

  it("requires one exact command and reports unavailable state without leaking inputs", async () => {
    const cwd = await temporaryRoot();
    for (const argv of [
      [] as string[],
      ["unknown"],
      ["aggregate", "extra"],
      ["--cwd", cwd]
    ]) {
      const result = await runWorkBoardMonitoringCli(argv, { cwd });
      expect(result.exitCode).toBe(2);
      expect(JSON.parse(result.stdout)).toEqual({
        contract: "work-board-monitoring-cli-v0.1",
        command: null,
        status: "error",
        code: "INVALID_ARGUMENTS"
      });
      expect(result.stdout).not.toContain(cwd);
    }

    const aggregate = await runWorkBoardMonitoringCli(["aggregate"], {
      cwd
    });
    expect(aggregate.exitCode).toBe(2);
    expect(JSON.parse(aggregate.stdout)).toEqual({
      contract: "work-board-monitoring-cli-v0.1",
      command: "aggregate",
      scope: "stored_quality_aggregate_only",
      status: "unavailable",
      code: "CONFIG_UNAVAILABLE"
    });

    await writeConfig(cwd);
    const replay = await runWorkBoardMonitoringCli(["replay"], { cwd });
    expect(replay.exitCode).toBe(2);
    expect(JSON.parse(replay.stdout)).toEqual({
      contract: "work-board-monitoring-cli-v0.1",
      command: "replay",
      scope: "stored_quality_aggregate_only",
      status: "unavailable",
      code: "STORE_MISSING"
    });
  });

  it("exposes the explicit package entrypoint with script argument isolation", async () => {
    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), "package.json"), "utf8")
    ) as { scripts: Record<string, string> };
    expect(packageJson.scripts["work-board:monitoring"]).toBe(
      "vite-node --script tools/run-work-board-monitoring.ts"
    );

    let failure: unknown;
    try {
      await execFileAsync(
        join(process.cwd(), "node_modules", ".bin", "vite-node"),
        [
          "--script",
          join(process.cwd(), "tools", "run-work-board-monitoring.ts"),
          "unknown"
        ],
        { cwd: process.cwd(), encoding: "utf8" }
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      code: 2,
      stderr: ""
    });
    const stdout = (failure as { stdout: string }).stdout;
    expect(JSON.parse(stdout)).toEqual({
      contract: "work-board-monitoring-cli-v0.1",
      command: null,
      status: "error",
      code: "INVALID_ARGUMENTS"
    });
  });
});

async function prepareMonitoringRoot(): Promise<string> {
  const cwd = await temporaryRoot();
  await writeConfig(cwd);
  const receipt = createWorkBoardMonitoringReceipt({
    authority: monitoringAuthority(),
    issuedAt: MONITORING_NOW
  });
  if (receipt === null) throw new Error("Invalid monitoring fixture");
  await mutate(cwd, {
    operation: "consent",
    consent: true,
    explicitUserAction: true
  });
  await mutate(cwd, {
    operation: "render_confirmed",
    receipt: receipt.headerValue
  });
  await mutate(cwd, {
    operation: "feedback",
    receipt: receipt.headerValue,
    ordinal: 1,
    feedback: "useful",
    explicitUserAction: true
  });
  return cwd;
}

async function writeConfig(cwd: string): Promise<void> {
  await writeStoredCodexConfig(
    {
      schemaVersion: "codex-connector-config-v3",
      installationSecret: MONITORING_SECRET,
      selectedScopeIds: [],
      scopes: [],
      contentMode: "metadata_only",
      contentConsentAt: null,
      conversationConsentContract: null,
      conversationConsentAt: null,
      conversationRetentionDays: null,
      discoveredAt: MONITORING_NOW.toISOString()
    },
    cwd
  );
}

function mutate(
  cwd: string,
  mutation: Parameters<
    typeof recordWorkBoardMonitoringMutation
  >[0]["mutation"]
) {
  return recordWorkBoardMonitoringMutation({
    cwd,
    installationSecret: MONITORING_SECRET,
    mutation,
    clock: () => new Date(MONITORING_NOW)
  });
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "work-board-monitoring-cli-"));
  roots.push(root);
  return root;
}

async function filesystemSnapshot(root: string): Promise<unknown[]> {
  const output: unknown[] = [];
  await visit(root);
  return output;

  async function visit(directory: string): Promise<void> {
    const entries = (await readdir(directory, { withFileTypes: true })).sort(
      (left, right) => left.name.localeCompare(right.name)
    );
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const metadata = await stat(path);
      const relativePath = relative(root, path);
      if (entry.isDirectory()) {
        output.push({
          relativePath,
          kind: "directory",
          mode: metadata.mode & 0o777,
          mtimeMs: metadata.mtimeMs
        });
        await visit(path);
      } else {
        output.push({
          relativePath,
          kind: "file",
          mode: metadata.mode & 0o777,
          mtimeMs: metadata.mtimeMs,
          bytes: (await readFile(path)).toString("base64")
        });
      }
    }
  }
}

function expectPrivateValuesAbsent(stdout: string, cwd: string): void {
  for (const forbidden of [
    cwd,
    MONITORING_SECRET,
    "wbm1.",
    "ordinalHandleHmac",
    "presentationTargetHmac",
    "receiptDigestHmac",
    "privateProvenanceHmac",
    "item_ref_",
    "context_ref_",
    "현재 확인할 Attention",
    "QA 진행 상태 확인하기"
  ]) {
    expect(stdout).not.toContain(forbidden);
  }
}

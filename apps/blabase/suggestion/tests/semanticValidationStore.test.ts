import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  utimes,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { capturePreservingLocalState } from "../src/attention/preserveCapture";
import {
  createEmptySemanticValidationStore,
  createSemanticValidationRunningReceipt,
  semanticValidationBindingForIntent
} from "../src/semanticContinuation/validation/contracts";
import {
  acquireSemanticValidationRunLease,
  appendStoredSemanticValidationReceipt,
  appendStoredSemanticValidationReceiptUnderAuthorityLease,
  readSemanticValidationStore,
  semanticValidationLocalDirectory,
  withSemanticContinuationAuthorityLease
} from "../src/semanticContinuation/validation/store";
import { createSemanticContinuationIntentDecision } from "../src/semanticContinuation";

const INSTALLATION_SECRET = "1".repeat(64);
const OTHER_INSTALLATION_SECRET = "2".repeat(64);
const ITEM_REF = `item_ref_${"a".repeat(43)}`;
const CONTEXT_REF = `context_ref_${"b".repeat(43)}`;
const STARTED_AT = "2026-08-13T12:10:00.000Z";
const created: string[] = [];

afterEach(async () => {
  await Promise.all(
    created.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe("Semantic Validation private store", () => {
  it("writes authenticated state with private modes and reads wrong-key state purely", async () => {
    const cwd = await temporaryWorkspace();
    const receipt = runningReceipt({
      runId: runId("a"),
      receiptRevision: 1,
      previousReceiptSha256: null
    });
    const store = await appendStoredSemanticValidationReceipt({
      cwd,
      installationSecret: INSTALLATION_SECRET,
      receipt,
      createAt: STARTED_AT
    });
    const directory = semanticValidationLocalDirectory(cwd);
    const target = join(directory, "receipts.json");
    const before = await readFile(target, "utf8");

    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(target)).mode & 0o777).toBe(0o600);
    await expect(
      readSemanticValidationStore(cwd, INSTALLATION_SECRET)
    ).resolves.toEqual({ status: "available", value: store });
    await expect(
      readSemanticValidationStore(cwd, OTHER_INSTALLATION_SECRET)
    ).resolves.toEqual({
      status: "invalid",
      reason: "AUTHORITY_INVALID"
    });
    expect(await readFile(target, "utf8")).toBe(before);
  });

  it("serializes concurrent authenticated appends without losing the chain head", async () => {
    const cwd = await temporaryWorkspace();
    const runIds = [runId("a"), runId("b"), runId("c")];

    await Promise.all(
      runIds.map((candidate) => appendRunningUnderAuthority(cwd, candidate))
    );

    const read = await readSemanticValidationStore(
      cwd,
      INSTALLATION_SECRET
    );
    expect(read.status).toBe("available");
    if (read.status !== "available") return;
    expect(read.value.revision).toBe(3);
    expect(read.value.receipts).toHaveLength(3);
    expect(new Set(read.value.receipts.map((receipt) => receipt.runId))).toEqual(
      new Set(runIds)
    );
    expect(
      read.value.receipts.every(
        (receipt, index) =>
          receipt.receiptRevision === index + 1 &&
          receipt.previousReceiptSha256 ===
            (index === 0
              ? null
              : read.value.receipts[index - 1]!.receiptSha256)
      )
    ).toBe(true);
    expect(read.value.currentRunId).toBe(
      read.value.receipts.at(-1)?.runId
    );
    expect(read.value.currentReceiptSha256).toBe(
      read.value.receipts.at(-1)?.receiptSha256
    );
  });

  it("lets exactly one live run lease win and releases it for the next run", async () => {
    const cwd = await temporaryWorkspace();
    const first = await acquireSemanticValidationRunLease({
      cwd,
      runId: runId("a")
    });
    expect(first).not.toBeNull();
    if (first === null) return;

    try {
      const lockPath = join(
        semanticValidationLocalDirectory(cwd),
        "run.lock"
      );
      expect((await stat(lockPath)).mode & 0o777).toBe(0o600);
      await expect(first.assertCurrent()).resolves.toBeUndefined();
      await expect(
        acquireSemanticValidationRunLease({ cwd, runId: runId("b") })
      ).resolves.toBeNull();
    } finally {
      await first.stop();
    }

    const next = await acquireSemanticValidationRunLease({
      cwd,
      runId: runId("c")
    });
    expect(next).not.toBeNull();
    await next?.stop();
  });

  it("reclaims a stale dead-process lease and reports the abandoned run", async () => {
    const cwd = await temporaryWorkspace();
    const initializer = await acquireSemanticValidationRunLease({
      cwd,
      runId: runId("a")
    });
    expect(initializer).not.toBeNull();
    await initializer?.stop();

    const lockPath = join(
      semanticValidationLocalDirectory(cwd),
      "run.lock"
    );
    await writeFile(
      lockPath,
      `${JSON.stringify({
        token: "e".repeat(32),
        ownerPid: 2_147_483_647,
        runId: runId("b")
      })}\n`,
      { encoding: "utf8", mode: 0o600 }
    );
    await chmod(lockPath, 0o600);
    const staleAt = new Date(Date.now() - 31_000);
    await utimes(lockPath, staleAt, staleAt);

    const contenders = await Promise.all([
      acquireSemanticValidationRunLease({ cwd, runId: runId("c") }),
      acquireSemanticValidationRunLease({ cwd, runId: runId("d") })
    ]);
    const recovered = contenders.find((lease) => lease !== null) ?? null;
    expect(contenders.filter((lease) => lease !== null)).toHaveLength(1);
    expect(recovered?.abandonedRunId).toBe(runId("b"));
    await recovered?.stop();
  });

  it("recovers a safe receipt temp only on the next authorized mutation", async () => {
    const cwd = await temporaryWorkspace();
    await appendRunningUnderAuthority(cwd, runId("a"));
    const directory = semanticValidationLocalDirectory(cwd);
    const temporary = join(
      directory,
      "receipts.json.995.aaaaaaaaaaaaaaaa.tmp"
    );
    await writeFile(temporary, "private-validation-temp-sentinel", {
      encoding: "utf8",
      mode: 0o600
    });

    await expect(
      capturePreservingLocalState({
        cwd,
        scope: "semantic",
        read: () => readSemanticValidationStore(cwd, INSTALLATION_SECRET)
      })
    ).rejects.toBeDefined();
    expect(await readFile(temporary, "utf8")).toBe(
      "private-validation-temp-sentinel"
    );

    await appendRunningUnderAuthority(cwd, runId("b"));
    expect(await readdir(directory)).toEqual(["receipts.json"]);
    const captured = await capturePreservingLocalState({
      cwd,
      scope: "semantic",
      read: () => readSemanticValidationStore(cwd, INSTALLATION_SECRET)
    });
    expect(captured.status).toBe("available");
  });

  it("does not delete hostile validation temp symlinks or wrong-mode files", async () => {
    const symlinkCwd = await temporaryWorkspace();
    const outside = await temporaryWorkspace();
    await appendRunningUnderAuthority(symlinkCwd, runId("a"));
    const outsideTarget = join(outside, "outside-validation-sentinel");
    await writeFile(outsideTarget, "outside-validation-sentinel", {
      encoding: "utf8",
      mode: 0o600
    });
    const hostileLink = join(
      semanticValidationLocalDirectory(symlinkCwd),
      "receipts.json.994.bbbbbbbbbbbbbbbb.tmp"
    );
    await symlink(outsideTarget, hostileLink);
    await expect(
      appendRunningUnderAuthority(symlinkCwd, runId("b"))
    ).rejects.toBeDefined();
    expect(await readFile(outsideTarget, "utf8")).toBe(
      "outside-validation-sentinel"
    );

    const wrongModeCwd = await temporaryWorkspace();
    await appendRunningUnderAuthority(wrongModeCwd, runId("c"));
    const wrongModeTemp = join(
      semanticValidationLocalDirectory(wrongModeCwd),
      "receipts.json.993.cccccccccccccccc.tmp"
    );
    await writeFile(wrongModeTemp, "private-validation-temp-sentinel", {
      encoding: "utf8",
      mode: 0o644
    });
    await expect(
      appendRunningUnderAuthority(wrongModeCwd, runId("d"))
    ).rejects.toBeDefined();
    expect((await stat(wrongModeTemp)).mode & 0o777).toBe(0o644);
  });
});

async function appendRunningUnderAuthority(cwd: string, candidate: string) {
  return withSemanticContinuationAuthorityLease(cwd, async () => {
    const read = await readSemanticValidationStore(cwd, INSTALLATION_SECRET);
    if (read.status === "invalid") throw new TypeError("Synthetic store invalid");
    const store =
      read.status === "available"
        ? read.value
        : createEmptySemanticValidationStore({
            createdAt: STARTED_AT,
            installationSecret: INSTALLATION_SECRET
          });
    const receipt = runningReceipt({
      runId: candidate,
      receiptRevision: store.revision + 1,
      previousReceiptSha256:
        store.receipts.at(-1)?.receiptSha256 ?? null
    });
    return appendStoredSemanticValidationReceiptUnderAuthorityLease({
      cwd,
      installationSecret: INSTALLATION_SECRET,
      receipt,
      createAt: STARTED_AT
    });
  });
}

function runningReceipt(input: {
  runId: string;
  receiptRevision: number;
  previousReceiptSha256: string | null;
}) {
  return createSemanticValidationRunningReceipt({
    ...input,
    binding: semanticValidationBindingForIntent(semanticIntent()),
    startedCodeProvenance: {
      kind: "clean",
      codeState: "clean_commit",
      codeCommitSha: "d".repeat(40),
      codeFingerprintSha256: null
    },
    startedAt: STARTED_AT,
    installationSecret: INSTALLATION_SECRET
  });
}

function semanticIntent() {
  return createSemanticContinuationIntentDecision({
    confirmation: {
      intent: "QA_RUN",
      subjectLabel: "blabase",
      itemRef: ITEM_REF,
      workContextRef: CONTEXT_REF,
      explicitUserConfirmation: true
    },
    target: {
      itemRef: ITEM_REF,
      workContextRef: CONTEXT_REF,
      observedAt: "2026-08-13T10:00:00.000Z",
      candidateExpiresAt: "2026-08-15T12:00:00.000Z"
    },
    registrySha256: "c".repeat(64),
    confirmedAt: "2026-08-13T12:00:00.000Z",
    supersedesDecisionId: null
  });
}

function runId(fill: string): string {
  return `semantic_validation_run_${fill.repeat(32)}`;
}

async function temporaryWorkspace(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "semantic-validation-"));
  created.push(cwd);
  return cwd;
}

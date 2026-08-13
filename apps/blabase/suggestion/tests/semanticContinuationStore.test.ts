import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  confirmStoredSemanticContinuationIntent,
  readSemanticContinuationIntentStore,
  semanticContinuationLocalDirectory
} from "../src/semanticContinuation";

const created: string[] = [];
const ITEM_REF = `item_ref_${"a".repeat(43)}`;
const CONTEXT_REF = `context_ref_${"b".repeat(43)}`;

afterEach(async () => {
  await Promise.all(
    created.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe("Semantic Continuation private local store", () => {
  it("atomically appends explicit decisions and records supersession", async () => {
    const cwd = await temporaryWorkspace();
    const first = await confirm(cwd, "alpha", "2026-08-13T12:00:00.000Z");
    const second = await confirm(cwd, "blabase", "2026-08-13T12:01:00.000Z");
    const read = await readSemanticContinuationIntentStore(cwd);

    expect(read.status).toBe("available");
    if (read.status !== "available") return;
    expect(read.value.revision).toBe(2);
    expect(read.value.decisions).toHaveLength(2);
    expect(second.decision.supersedesDecisionId).toBe(
      first.decision.decisionId
    );
    const directoryMode = (await stat(semanticContinuationLocalDirectory(cwd))).mode & 0o777;
    const fileMode = (await stat(
      join(semanticContinuationLocalDirectory(cwd), "intent-store.json")
    )).mode & 0o777;
    expect(directoryMode).toBe(0o700);
    expect(fileMode).toBe(0o600);
  });

  it("serializes concurrent confirmations without losing a revision", async () => {
    const cwd = await temporaryWorkspace();
    await Promise.all([
      confirm(cwd, "alpha", "2026-08-13T12:00:00.000Z"),
      confirm(cwd, "beta", "2026-08-13T12:00:00.000Z"),
      confirm(cwd, "gamma", "2026-08-13T12:00:00.000Z")
    ]);
    const read = await readSemanticContinuationIntentStore(cwd);

    expect(read.status).toBe("available");
    if (read.status !== "available") return;
    expect(read.value.revision).toBe(3);
    expect(read.value.decisions).toHaveLength(3);
  });

  it("reads corrupt state without rewriting it", async () => {
    const cwd = await temporaryWorkspace();
    const directory = semanticContinuationLocalDirectory(cwd);
    await mkdir(directory, { recursive: true });
    const target = join(directory, "intent-store.json");
    await writeFile(target, "{private-corrupt-sentinel", "utf8");

    await expect(readSemanticContinuationIntentStore(cwd)).resolves.toEqual({
      status: "invalid",
      reason: "PARSE_FAILED"
    });
    expect(await readFile(target, "utf8")).toBe(
      "{private-corrupt-sentinel"
    );

    const schemaCwd = await temporaryWorkspace();
    await confirm(schemaCwd, "blabase", "2026-08-13T12:00:00.000Z");
    const schemaTarget = join(
      semanticContinuationLocalDirectory(schemaCwd),
      "intent-store.json"
    );
    const tampered = JSON.parse(await readFile(schemaTarget, "utf8")) as {
      revision: number;
    };
    tampered.revision += 1;
    const tamperedText = `${JSON.stringify(tampered)}\n`;
    await writeFile(schemaTarget, tamperedText, "utf8");

    await expect(
      readSemanticContinuationIntentStore(schemaCwd)
    ).resolves.toEqual({ status: "invalid", reason: "SCHEMA_INVALID" });
    expect(await readFile(schemaTarget, "utf8")).toBe(tamperedText);
  });
});

async function temporaryWorkspace(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "semantic-continuation-"));
  created.push(cwd);
  return cwd;
}

function confirm(cwd: string, subjectLabel: string, confirmedAt: string) {
  return confirmStoredSemanticContinuationIntent(
    {
      confirmation: {
        intent: "QA_RUN",
        subjectLabel,
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
      registrySha256: "f".repeat(64),
      confirmedAt
    },
    cwd
  );
}
